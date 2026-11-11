// Package notify sends the email for each outbox event (R-80, R-82, R-84, R-94, R-96, R-107, R-148), each under one Resend
// Idempotency-Key on every retry, so a lost answer sends nothing twice. Nothing logs an address, a subject or a body.
package notify

import (
	"cmp"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/document"
	"github.com/forwend/forwend/apps/backend/internal/email"
	"github.com/forwend/forwend/apps/backend/internal/history"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/outbox"
	"github.com/forwend/forwend/apps/backend/internal/webhook"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// With Backoff, MaxAttempts ends within a few hours, inside Resend's 24-hour idempotency window.
const MaxAttempts = 10

// Batch bounds the events one call sends, so a backlog never holds up the worker's chain rounds.
const Batch = 20

func Backoff(n int) time.Duration {
	return min(time.Minute<<min(n-1, 6), time.Hour)
}

func Deliver(ctx context.Context, pool *pgxpool.Pool, sender email.Sender, site Site) error {
	for range Batch {
		more, err := deliverOne(ctx, pool, sender, site)
		if err != nil || !more {
			return err
		}
	}
	return nil
}

// dropToken removes an invite's link token from its row once the email is sent, skipped or given up: then only its
// hash is left (R-139).
const dropToken = "payload = payload - 'token'"

// deliverOne sends the oldest due event; false when none is due or a send fails other than by refusal.
func deliverOne(ctx context.Context, pool *pgxpool.Pool, sender email.Sender, site Site) (bool, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("deliver email: %w", err)
	}
	defer tx.Rollback(ctx)
	var (
		id                                         int64
		kind, invoice, user, job, invite, endpoint string
		transfer                                   int64
		payload                                    []byte
		attempts                                   int
	)
	err = tx.QueryRow(ctx, `SELECT id, kind, coalesce(invoice_id, ''), coalesce(user_id::text, ''),
		    coalesce(job_id::text, ''), coalesce(invite_id::text, ''), coalesce(endpoint_id::text, ''),
		    coalesce(wallet_transfer_id, 0), payload, attempts
		FROM outbox_events WHERE published_at IS NULL AND failed_at IS NULL AND next_attempt_at <= now()
		ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`).Scan(&id, &kind, &invoice, &user, &job, &invite, &endpoint, &transfer,
		&payload, &attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	} else if err != nil {
		return false, fmt.Errorf("claim email event: %w", err)
	}
	// A read that fails rolls back to here, so the claim's transaction can still record the failed try.
	sp, err := tx.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("deliver email: %w", err)
	}
	var (
		v     view
		to    *string
		on    bool
		scope string // what the event is about, for the Idempotency-Key
	)
	switch kind {
	case outbox.Welcome:
		// About the account, not a profile's invoices: the profile's email setting doesn't apply (R-84).
		on, scope, v = true, "user-"+user, welcome(site.WebURL+"/app")
		if err = sp.QueryRow(ctx, "SELECT login_email FROM users WHERE id = $1", user).Scan(&to); err != nil {
			err = fmt.Errorf("read email event %d user: %w", id, err)
		}
	case outbox.Change:
		scope = "job-" + job
		if v, to, on, err = changeEmail(ctx, sp, job, payload, site.WebURL); err != nil {
			err = fmt.Errorf("read email event %d: %w", id, err)
		}
	case outbox.Invite:
		scope = "invite-" + invite
		if v, to, on, err = inviteEmail(ctx, sp, invite, payload, site.WebURL); err != nil {
			err = fmt.Errorf("read email event %d: %w", id, err)
		}
	case outbox.WalletOutflow:
		// About the owner's money: the profile's email setting doesn't apply.
		on, scope = true, fmt.Sprintf("outflow-%d", transfer)
		var symbol, counterparty, hash, amount string
		var decimals int
		var chainID uint64
		if err = sp.QueryRow(ctx, `SELECT u.login_email, t.symbol, t.decimals, w.chain_id, w.counterparty, w.tx_hash,
			    w.amount::text
			FROM wallet_transfers w JOIN profile_wallets pw ON pw.address = w.wallet_address
			JOIN profiles p ON p.id = pw.profile_id JOIN users u ON u.id = p.user_id
			JOIN tokens t ON t.chain_id = w.chain_id AND t.contract = w.token_contract WHERE w.id = $1`, transfer).
			Scan(&to, &symbol, &decimals, &chainID, &counterparty, &hash, &amount); err != nil {
			err = fmt.Errorf("read email event %d transfer: %w", id, err)
			break
		}
		units, _ := new(big.Int).SetString(amount, 10)
		v = outflow(document.Amount(units, decimals, symbol), counterparty, document.NetworkName(chainID),
			document.TxURL(chainID, hash), site.WebURL+"/app/settings")
	case outbox.SettleWaiting:
		// About the account's settlements, so the profile's email setting doesn't apply.
		on, scope, v = true, "waiting-"+invoice, waiting(site.WebURL+"/app/transactions")
		if err = sp.QueryRow(ctx, `SELECT u.login_email FROM invoices i JOIN profiles p ON p.id = i.profile_id
			JOIN users u ON u.id = p.user_id WHERE i.id = $1`, invoice).Scan(&to); err != nil {
			err = fmt.Errorf("read email event %d owner: %w", id, err)
		}
	case outbox.RetainerFailed:
		// About the owner's own billing, so the profile's email setting doesn't apply.
		on, scope = true, "retainer-"+invoice
		var number int64
		var client string
		if err = sp.QueryRow(ctx, `SELECT u.login_email, i.number, coalesce(i.client_name, i.client_email, '')
			FROM invoices i JOIN profiles p ON p.id = i.profile_id JOIN users u ON u.id = p.user_id WHERE i.id = $1`,
			invoice).Scan(&to, &number, &client); err != nil {
			err = fmt.Errorf("read email event %d invoice: %w", id, err)
			break
		}
		var p outbox.Payload
		if err = json.Unmarshal(payload, &p); err != nil {
			break
		}
		v = retainerFailed(document.Number(number), client, document.DateText(p.Due), site.WebURL+"/app/invoices/"+invoice)
	case outbox.WebhookDisabled:
		scope = "endpoint-" + endpoint
		if v, to, on, err = disabledEmail(ctx, sp, endpoint, payload, site.WebURL); err != nil {
			err = fmt.Errorf("read email event %d: %w", id, err)
		}
	default:
		scope = invoice
		if v, to, on, err = invoiceEmail(ctx, sp, kind, invoice, payload, site.WebURL); err != nil {
			err = fmt.Errorf("read email event %d: %w", id, err)
		}
	}
	if err != nil {
		if err := sp.Rollback(ctx); err != nil {
			return false, fmt.Errorf("deliver email: %w", err)
		}
		return failed(ctx, tx, id, kind, invoice, payload, attempts, err, true)
	}
	if err := sp.Commit(ctx); err != nil {
		return false, fmt.Errorf("deliver email: %w", err)
	}
	if !on || to == nil || *to == "" {
		// Email off for this profile, or no login email ('' when the account has none; NULL when it was never read):
		// nothing to send, and nothing waits for it.
		if _, err := tx.Exec(ctx, "UPDATE outbox_events SET published_at = now(), "+dropToken+" WHERE id = $1",
			id); err != nil {
			return false, fmt.Errorf("skip email event %d: %w", id, err)
		}
		return true, tx.Commit(ctx)
	}
	// The key holds the invoice, user or job id because event ids restart in another database sharing the Resend team,
	// and a hash of the address and the message because Resend refuses a key it already saw with another body: an
	// invoice edited between two tries changes it.
	m, err := message(site, v)
	if err != nil {
		err = fmt.Errorf("render email event %d: %w", id, err)
		return failed(ctx, tx, id, kind, invoice, payload, attempts, err, true)
	}
	m.To = *to
	sum := sha256.Sum256(fmt.Appendf(nil, "%q|%q|%q|%q|%q|%q", m.To, m.Subject, m.Text, m.HTML, m.ReplyTo, m.Unsubscribe))
	m.Key = fmt.Sprintf("forwend-%s-%d-%x", scope, id, sum[:8])
	if sent := sender.Send(ctx, m); sent != nil {
		// Any send failure other than a refusal stops the round, so a failing or hanging Resend doesn't hold up the
		// worker's chain rounds.
		return failed(ctx, tx, id, kind, invoice, payload, attempts, sent, errors.Is(sent, email.ErrRefused))
	}
	if _, err := tx.Exec(ctx, "UPDATE outbox_events SET attempts = attempts + 1, published_at = now(), "+dropToken+
		" WHERE id = $1", id); err != nil {
		return false, fmt.Errorf("record email event %d: %w", id, err)
	}
	if err := addHistory(ctx, tx, kind, invoice, payload, false); err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}

// failed counts a failed try with Backoff and gives up after MaxAttempts; next says whether the round goes on. A refused
// message or an event that can't be read or rendered must not hold up every email behind it (R-115).
func failed(ctx context.Context, tx pgx.Tx, id int64, kind, invoice string, payload []byte, attempts int, cause error,
	next bool) (bool, error) {
	attempts++
	var err error
	if attempts >= MaxAttempts {
		slog.Error("email given up", "event", id, "kind", kind, "attempts", attempts, "err", cause)
		_, err = tx.Exec(ctx, "UPDATE outbox_events SET attempts = $2, failed_at = now(), "+dropToken+" WHERE id = $1",
			id, attempts)
		if err == nil {
			err = addHistory(ctx, tx, kind, invoice, payload, true)
		}
	} else {
		slog.Warn("email failed; trying again later", "event", id, "kind", kind, "attempt", attempts, "err", cause)
		_, err = tx.Exec(ctx, "UPDATE outbox_events SET attempts = $2, next_attempt_at = now() + $3 WHERE id = $1",
			id, attempts, Backoff(attempts))
	}
	if err != nil {
		return false, fmt.Errorf("record email event %d failure: %w", id, err)
	}
	return next, tx.Commit(ctx)
}

// The client's and payer's emails go in the invoice's history (R-126): sent, or failed once given up.
var emailed = map[string]struct{ sent, failed string }{
	outbox.Sent:     {history.InvoiceEmailed, history.InvoiceEmailFailed},
	outbox.Reminder: {history.ReminderEmailed, history.ReminderEmailFailed},
	outbox.Receipt:  {history.ReceiptEmailed, history.ReceiptEmailFailed},
}

func addHistory(ctx context.Context, tx pgx.Tx, kind, invoice string, payload []byte, failed bool) error {
	h, ok := emailed[kind]
	if !ok {
		return nil
	}
	var p outbox.Payload
	_ = json.Unmarshal(payload, &p) // read once already, to write the message
	k := h.sent
	if failed {
		k = h.failed
	}
	return history.Add(ctx, tx, invoice, k, cmp.Or(p.By, history.System), history.Data{Step: p.Step})
}

// invoiceEmail goes to the owner when email is on, to the payer for a receipt, and to the client for a send.
func invoiceEmail(ctx context.Context, tx pgx.Tx, kind, invoice string, payload []byte,
	webURL string) (view, *string, bool, error) {
	var p outbox.Payload
	if err := json.Unmarshal(payload, &p); err != nil {
		return view{}, nil, false, err
	}
	if kind == outbox.Reminder {
		return reminderEmail(ctx, tx, invoice, p, webURL)
	}
	var (
		on                   bool
		to, payer            *string
		number               *int64
		symbol, amount, hash string
		issuer, typed        string
		client, replyTo, due string
		pay                  string // the pay link's token (D-86)
		decimals, options    int
		chainID              uint64
		live                 bool
		paidWith             []string // a payment through NEAR Intents: symbol, chain, amount sent, decimals (R-239)
	)
	if err := tx.QueryRow(ctx, `SELECT p.email_notifications, u.login_email, m.payer_email, m.number,
		    coalesce(m.issuer_name, ''), coalesce(m.sender_name, ''), t.symbol, t.decimals, o.chain_id, o.amount::text,
		    coalesce((SELECT d.tx_hash FROM chain_transfers d
		              JOIN ledger_transactions x ON x.chain_transfer_id = d.id AND x.kind IN ('deposit', 'reopen', 'chosen')
		              JOIN ledger_entries e ON e.transaction_id = x.id AND e.account = 'recipient_payable'
		              WHERE d.invoice_id = o.id ORDER BY d.block_number DESC, d.log_index DESC LIMIT 1), ''),
		    coalesce(m.client_email, ''), coalesce(m.issuer_email, ''), coalesce(m.due_date::text, ''),
		    (SELECT count(*) FROM invoices x WHERE coalesce(x.main_id, x.id) = m.id), coalesce(m.pay_token, ''),
		    (SELECT livemode FROM chains c WHERE c.chain_id = o.chain_id),
		    (SELECT ARRAY[q.origin_symbol, q.origin_blockchain, coalesce(q.deposited_amount, q.amount_in)::text,
		                  q.origin_decimals::text]
		     FROM crosschain_quotes q WHERE q.option_id = o.id AND q.status = 'SUCCESS' ORDER BY q.converted_at DESC LIMIT 1)
		FROM invoices m JOIN profiles p ON p.id = m.profile_id JOIN users u ON u.id = p.user_id
		JOIN invoices o ON o.id = $2 JOIN tokens t ON t.chain_id = o.chain_id AND t.contract = o.token_contract
		WHERE m.id = $1`, invoice, p.Option).Scan(&on, &to, &payer, &number, &issuer, &typed, &symbol, &decimals, &chainID,
		&amount, &hash, &client, &replyTo, &due, &options, &pay, &live, &paidWith); err != nil {
		return view{}, nil, false, fmt.Errorf("invoice: %w", err)
	}
	// An invoice made before D-86 has no pay link: the client's and the payer's emails would link nowhere.
	if pay == "" && (kind == outbox.Sent || kind == outbox.Receipt) {
		return view{}, nil, false, nil
	}
	// The payer's receipt goes to the address they gave, whatever the owner's setting (R-82).
	if kind == outbox.Receipt {
		on, to = true, payer
	}
	if p.Amount != "" {
		amount = p.Amount
	}
	units, _ := new(big.Int).SetString(amount, 10)
	reference := "Payment " + invoice[2:14]
	ownerURL := webURL + "/app/payments/" + invoice
	if number != nil {
		reference = document.Number(*number)
		ownerURL = webURL + "/app/invoices/" + invoice
	}
	if kind == outbox.Sent {
		// The owner sent it, so the owner's setting doesn't apply (R-94).
		network := document.NetworkName(chainID)
		if options > 1 { // the client chooses the token and network, each at 1 USD (D-75)
			symbol, network = "USD", ""
		}
		return marked(sent(reference, document.Amount(units, decimals, symbol), network, issuer, typed,
				document.DateText(due), replyTo, webURL+"/pay/"+pay, webURL+"/api/v1/invoices/"+pay+"/invoice.pdf"), live),
			&client, true, nil
	}
	var v view
	if kind == outbox.Receipt {
		v = receipt(reference, document.Amount(units, decimals, symbol), document.NetworkName(chainID), issuer, typed,
			document.TxURL(chainID, hash), webURL+"/api/v1/invoices/"+pay+"/receipt.pdf")
	} else {
		v = compose(kind, reference, document.Amount(units, decimals, symbol), document.NetworkName(chainID), ownerURL,
			webURL+"/app/notifications")
		if number == nil {
			v.Button.Label = "View payment"
		}
	}
	if len(paidWith) == 4 && (kind == outbox.Receipt || kind == outbox.Paid) {
		sent, _ := new(big.Int).SetString(paidWith[2], 10)
		places, _ := strconv.Atoi(paidWith[3])
		v.Details = append(v.Details, row{Label: "Paid with",
			Value: document.PaidWith(sent, places, paidWith[0], paidWith[1])})
	}
	// The payer's receipt and the owner's own emails say test mode too: testnet tokens never read as real money.
	return marked(v, live), to, on, nil
}

func compose(kind, number, amount, network, link, settings string) view {
	v := view{Amount: amount, Tone: "success", Button: button{"View invoice", link},
		Details: []row{{Label: "Network", Value: network}},
		Reason:  "Sent because email is on for this profile.", Settings: settings}
	switch kind {
	case outbox.Paid:
		v.Subject, v.Title = number+" paid: "+amount, number+" was paid"
		v.Preheader = "Paid on " + network + "."
		v.Lead = []string{"The money is on its way to your wallet."}
	case outbox.Settled:
		v.Subject, v.Title = number+": "+amount+" is in your wallet", "Money for "+number+" is in your wallet"
		v.Preheader = "Settled on " + network + " and ready to use."
		v.Lead = []string{"That’s what reached your wallet, less any fees. It now shows in your balance."}
	default: // outbox.Held
		v.Subject, v.Tone, v.Title = number+": "+amount+" held for the payer", "warning",
			number+": money held for the payer"
		v.Preheader = "Received on " + network + "."
		v.Lead = []string{"It doesn’t count toward the invoice, so it isn’t paid to you. Forwend support handles any " +
			"return to the payer, so you don’t need to do anything."}
		v.Note = "Money is held when it’s over the amount due, part of a payment when checkout closed, arrives " +
			"after checkout closed or the invoice was canceled, or goes to another payment option."
	}
	return v
}

// welcome is a new account's one welcome email (R-84).
func welcome(app string) view {
	return view{Subject: "Welcome to Forwend", Preheader: "Your account is ready.", Title: "Welcome to Forwend",
		Lead: []string{"Create an invoice or a payment request, share its pay link, and get paid in stablecoins " +
			"to your wallet.", "Forwend emails you when an invoice is paid, when the money reaches your wallet, and if " +
			"money is held for a payer. You can turn these emails off for each profile."},
		Button: button{"Open Forwend", app}, Reason: "Sent once, because you created a Forwend account."}
}

// CodeMessage is the email with a Confirm it's you code (R-137); the api sends it at once, outside the outbox.
func CodeMessage(site Site, code string, ttl time.Duration) (email.Message, error) {
	return message(site, confirm(site.WebURL+"/app", code, ttl))
}

// confirm ends the subject with the code: the browser tests read it there (apps/web/e2e/privy/fake-resend.mjs).
func confirm(app, code string, ttl time.Duration) view {
	return view{Subject: "Your Forwend code: " + code, Preheader: "Use it to confirm it’s you.",
		Title: "Confirm it’s you", Amount: code,
		Lead:   []string{fmt.Sprintf("Enter this code in Forwend. It works for %d minutes.", int(ttl.Minutes()))},
		Note:   "Didn’t ask for it? Don’t share it, and sign out of all devices in Forwend’s Settings.",
		Button: button{"Open Forwend", app},
		Reason: "Sent because someone asked to confirm it’s you in Forwend."}
}

// unchecked goes with a name the invoice's creator typed. An email comes from Forwend, so it says so here; the PDF is
// the sender's own document and shows the name alone.
const unchecked = "This name is what the invoice’s creator gave. Forwend doesn’t check it."

// receipt is the payer's one email (R-82): nothing else is ever sent to this address.
func receipt(number, amount, network, issuer, sender, tx, pdf string) view {
	v := view{Subject: "Your receipt for " + number, Preheader: amount + " paid on " + network + ".", Tone: "success",
		Title: "Receipt for " + number, Amount: amount,
		Lead:    []string{"Your payment is complete. You don’t need to do anything else."},
		Details: []row{{Label: "Network", Value: network}}, Button: button{"Download receipt (PDF)", pdf},
		Reason: "Sent once, because you asked for a receipt on the payment page. Forwend sends nothing else to this " +
			"address."}
	to := issuer
	if to == "" && sender != "" {
		to, v.Note = sender, unchecked
	}
	if to != "" {
		v.Preheader = amount + " paid to " + to + "."
		v.Lead[0] = "Your payment to " + to + " is complete. You don’t need to do anything else."
	}
	if tx != "" {
		v.Details = append(v.Details, row{Label: "Transaction", Value: "View on the block explorer", Href: tx})
	}
	return v
}

// marked says an email is about a test-mode invoice (R-143), so testnet tokens never pass for real money.
func marked(v view, live bool) view {
	if !live {
		v.TestMode = document.TestMode + "."
	}
	return v
}

// payHow is the client's one line on paying: a payer needs no Forwend account (R-94, R-96).
const payHow = "from a crypto wallet or an exchange. You don’t need a Forwend account."

// sent is the invoice email to the client (R-94); network is empty when the client chooses.
func sent(number, amount, network, issuer, sender, due, replyTo, pay, pdf string) view {
	v := view{Subject: "Invoice " + number, Preheader: amount + " to pay online.", Amount: amount,
		Lead: []string{"Pay it online " + payHow}, Button: button{"View and pay", pay},
		Link: button{"Download the invoice (PDF)", pdf}, ReplyTo: replyTo,
		Reason: "Someone sent you this invoice through Forwend."}
	from := issuer
	if from == "" && sender != "" {
		from, v.Note = sender, unchecked
	}
	if from != "" {
		v.Subject += " from " + from
		v.Reason = from + " sent you this invoice through Forwend."
	}
	v.Title = v.Subject
	if due != "" {
		v.Preheader = amount + ", due " + due + "."
		v.Details = append(v.Details, row{Label: "Due date", Value: due})
	}
	if network == "" {
		network = "You choose on the payment page"
	}
	v.Details = append(v.Details, row{Label: "Network", Value: network})
	if replyTo != "" {
		v.Reason += " Reply to this email to reach them."
	}
	return v
}

// changeEmail sends only while the change still waits for the client (R-107): it may since be withdrawn or accepted.
func changeEmail(ctx context.Context, tx pgx.Tx, job string, payload []byte, webURL string) (view, *string, bool, error) {
	var p outbox.Payload
	if err := json.Unmarshal(payload, &p); err != nil {
		return view{}, nil, false, err
	}
	var (
		to                                   *string
		title, token, issuer, replyTo, named string
		cents                                int64
		days                                 int
	)
	err := tx.QueryRow(ctx, `SELECT j.accepted_email, j.title, j.token, j.issuer_name, j.issuer_email, c.title,
		    c.amount_cents, c.due_days
		FROM jobs j JOIN job_payments c ON c.job_id = j.id
		WHERE j.id = $1 AND c.change_key = $2 AND c.accepted_at IS NULL`, job, p.Change).Scan(&to, &title, &token,
		&issuer, &replyTo, &named, &cents, &days)
	if errors.Is(err, pgx.ErrNoRows) {
		return view{}, nil, false, nil
	} else if err != nil {
		return view{}, nil, false, fmt.Errorf("job change: %w", err)
	}
	return change(issuer, title, named, document.Amount(big.NewInt(cents), 2, "USD"), days, replyTo, webURL+"/w/"+token),
		to, true, nil
}

// inviteEmail sends only while the invite is open: it may have been revoked or accepted since it was queued.
func inviteEmail(ctx context.Context, tx pgx.Tx, invite string, payload []byte, webURL string) (view, *string, bool,
	error) {
	var p outbox.Payload
	if err := json.Unmarshal(payload, &p); err != nil {
		return view{}, nil, false, err
	}
	var to, name, role, replyTo string
	err := tx.QueryRow(ctx, `SELECT i.email, coalesce(p.name, ''), i.role, coalesce(u.login_email, '')
		FROM profile_invites i JOIN profiles p ON p.id = i.profile_id JOIN users u ON u.id = i.invited_by
		WHERE i.id = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()`, invite).
		Scan(&to, &name, &role, &replyTo)
	if errors.Is(err, pgx.ErrNoRows) {
		return view{}, nil, false, nil
	} else if err != nil {
		return view{}, nil, false, fmt.Errorf("team invite: %w", err)
	}
	return invitation(name, roleNames[role], replyTo, webURL+"/invite/"+p.Token), &to, true, nil
}

// disabledEmail goes to the profile owner whatever their email setting (R-148): nothing else tells them that
// deliveries stopped.
func disabledEmail(ctx context.Context, tx pgx.Tx, endpoint string, payload []byte, webURL string) (view, *string, bool,
	error) {
	var p outbox.Payload
	if err := json.Unmarshal(payload, &p); err != nil {
		return view{}, nil, false, err
	}
	var to *string
	var raw string
	if err := tx.QueryRow(ctx, `SELECT u.login_email, w.url FROM webhook_endpoints w
		JOIN profiles p ON p.id = w.profile_id JOIN users u ON u.id = p.user_id WHERE w.id = $1`, endpoint).
		Scan(&to, &raw); err != nil {
		return view{}, nil, false, fmt.Errorf("webhook endpoint: %w", err)
	}
	u, _ := url.Parse(raw) // saved only once it parsed
	return disabled(u.Hostname(), p.Reason, webURL+"/app/developers"), to, true, nil
}

// outflow tells the owner money left their wallet with no send they approved in Forwend (D-49): a stolen session can
// sign through Privy without Forwend's screens.
func outflow(amount, to, network, tx, link string) view {
	v := view{Subject: "Money left your wallet: " + amount,
		Preheader: "Sent on " + network + ", not through Forwend. Was it you?", Tone: "warning",
		Title: "Money left your wallet", Amount: amount, Button: button{"Open Account and security", link},
		Lead: []string{"It wasn’t a send you approved in Forwend. If you moved it yourself, for example from another " +
			"wallet app, nothing is wrong.", "If you didn’t, sign out of all devices now and contact support."},
		Details: []row{{Label: "To", Value: to}, {Label: "Network", Value: network}},
		Reason:  "Sent because money left one of your Forwend wallets."}
	if tx != "" {
		v.Details = append(v.Details, row{Label: "Transaction", Value: "View on the block explorer", Href: tx})
	}
	return v
}

// waiting tells the owner their paid invoices wait on the day's sponsored settlements (SEC-03).
func waiting(link string) view {
	return view{Subject: "Some payments are waiting to settle", Preheader: "The money is safe and settles as the daily " +
		"limit frees up.", Tone: "warning", Title: "Some payments are waiting to settle",
		Button: button{"Open Transactions", link},
		Lead: []string{"You were paid for more invoices in 24 hours than Forwend settles to your wallets in a day. The " +
			"rest wait safely at their receive addresses.", "If payments keep coming at this pace, contact support so " +
			"none waits past its settle deadline."},
		Reason: "Sent because payments to your profiles are waiting to settle."}
}

// retainerFailed tells the owner a retainer's month failed RetainerFailuresTold times in a row, so its client got no
// invoice yet (R-98).
func retainerFailed(number, client, due, link string) view {
	return view{Subject: "Repeating invoice not made: " + number, Preheader: "The invoice for " + client + " due " + due +
		" isn’t made yet.", Tone: "warning", Title: "A repeating invoice wasn’t made", Button: button{"View invoice", link},
		Lead: []string{"Forwend couldn’t make the next invoice for " + client + ". It keeps trying until the due date, " +
			"then skips the month.", "Check the profile’s tokens and billing details, or stop the repeat on the invoice page."},
		Details: []row{{Label: "Repeats", Value: number}, {Label: "Due date", Value: due}},
		Reason:  "Sent because a repeating invoice of your profile couldn’t be made."}
}

// disabled names only the endpoint's host: its path or query may hold the receiver's own token.
func disabled(host, reason, link string) view {
	why := "Forwend couldn’t deliver events to " + host + " for about 3 days, so it stopped sending them."
	if reason == webhook.Gone {
		why = host + " answered 410 Gone, so Forwend stopped sending events there."
	}
	return view{Subject: "Webhook endpoint turned off: " + host, Preheader: "No events go there until you turn it " +
		"back on.", Tone: "warning", Title: "Webhook endpoint turned off", Button: button{"Open Developers", link},
		Lead: []string{why, "Fix the endpoint, then turn it back on in Developers. Events from while it was off aren’t " +
			"sent to it."},
		Reason: "Sent because a webhook endpoint of your profile was turned off."}
}

var roleNames = map[string]string{"admin": "Admin", "developer": "Developer", "finance": "Finance"}

// invitation is a team invite's email to the address invited (R-139).
func invitation(team, role, replyTo, link string) view {
	return view{Subject: "Join " + team + " on Forwend", Preheader: "Invited as " + role + ".",
		Title: "Join " + team + " on Forwend", Button: button{"Accept the invite", link}, ReplyTo: replyTo,
		Lead: []string{"You’re invited as " + role + ". To accept, sign in to Forwend with this email address. The " +
			"link works once, within 7 days."},
		Reason: "Sent because a member of " + team + " invited this address. Not expecting it? Ignore it: nothing " +
			"happens until you accept."}
}

// change is a scope change's email to the client (R-107).
func change(issuer, job, title, amount string, days int, replyTo, link string) view {
	due := fmt.Sprintf("due %d days after", days)
	switch days {
	case 0:
		due = "due the day it is invoiced"
	case 1:
		due = "due 1 day after"
	}
	return view{Subject: issuer + " proposed a change to " + job, Preheader: "“" + title + "” for " + amount +
		", billed only if you accept.", Title: "A change to " + job, Amount: amount,
		Button: button{"Review the change", link}, ReplyTo: replyTo,
		Lead: []string{issuer + " proposed “" + title + "”.", "You pay for it only if you accept. Its invoice comes " +
			"when the work is done, " + due + "."},
		Reason: "Sent because you accepted " + issuer + "’s quote for " + job + " through Forwend. Reply to this email " +
			"to reach them."}
}

// reminderEmail sends only while reminders are on and something is left to pay on an open invoice (R-96): checked
// again now, since it may have been paid or the reminders stopped after the step was queued.
func reminderEmail(ctx context.Context, tx pgx.Tx, id string, p outbox.Payload, webURL string) (view, *string, bool, error) {
	var (
		on, locked                       bool
		to, issuer, sender, replyTo, due string
		symbol, left, token, pay         string
		number                           int64
		decimals, options                int
		chainID                          uint64
		live                             bool
	)
	if err := tx.QueryRow(ctx, `SELECT r.enabled AND r.stopped_at IS NULL
		        AND (SELECT `+invoice.StatusFilterSQL+` FROM invoices_current invoices WHERE invoices.id = m.id) = 'open',
		    coalesce(m.client_email, ''), coalesce(m.issuer_name, ''), coalesce(m.sender_name, ''),
		    coalesce(m.issuer_email, ''), coalesce(to_char(m.due_date, 'YYYY-MM-DD'), ''), m.number, t.symbol, t.decimals,
		    o.chain_id, (o.amount + `+invoice.PaidToOwnerSQL("o.id")+`)::text,
		    (SELECT count(*) FROM invoices c WHERE c.id = m.id OR c.main_id = m.id), m.chosen_id IS NOT NULL, r.stop_token,
		    coalesce(m.pay_token, ''), (SELECT livemode FROM chains c WHERE c.chain_id = o.chain_id)
		FROM invoices m JOIN invoice_reminders r ON r.invoice_id = m.id JOIN invoices o ON o.id = $2
		JOIN tokens t ON t.chain_id = o.chain_id AND t.contract = o.token_contract
		WHERE m.id = $1`, id, p.Option).Scan(&on, &to, &issuer, &sender, &replyTo, &due, &number, &symbol, &decimals,
		&chainID, &left, &options, &locked, &token, &pay, &live); err != nil {
		return view{}, nil, false, fmt.Errorf("reminder: %w", err)
	}
	units, _ := new(big.Int).SetString(left, 10)
	if units.Sign() <= 0 || pay == "" { // pay: no link before D-86
		on = false
	}
	network := document.NetworkName(chainID)
	if options > 1 && !locked { // the client still chooses the token and network, each at 1 USD (D-75)
		symbol, network = "USD", ""
	}
	v := marked(reminder(p.Step, document.Number(number), document.Amount(units, decimals, symbol), network, issuer, sender,
		document.DateText(due), replyTo, webURL+"/pay/"+pay, webURL+"/api/v1/invoices/"+pay+"/invoice.pdf"), live)
	v.Stop, v.Unsubscribe = webURL+"/reminders/"+token, webURL+"/api/v1/reminders/"+token+"/stop"
	return v, &to, on, nil
}

// reminder is a payment reminder (R-96); network is empty when the client chooses.
func reminder(step, number, left, network, issuer, sender, due, replyTo, pay, pdf string) view {
	v := view{Amount: left, Button: button{"View and pay", pay},
		Link: button{"Download the invoice (PDF)", pdf}, ReplyTo: replyTo}
	from := issuer
	if from == "" && sender != "" {
		from, v.Note = sender, unchecked
	}
	who, owed, by := number, "That’s what’s left to pay", "The sender"
	if from != "" {
		who, owed, by = number+" from "+from, owed+" to "+from, from
	}
	var is string
	switch step {
	case invoice.ReminderBefore:
		is, v.Preheader = "is due "+due, left+" left to pay by "+due+"."
		v.Lead = []string{owed + ". Pay it online " + payHow}
	case invoice.ReminderDue:
		is, v.Preheader = "is due today", left+" left to pay today."
		v.Lead = []string{owed + ". Pay it online " + payHow}
		v.Details = []row{{Label: "Due date", Value: due}}
	default: // invoice.ReminderAfter
		is, v.Preheader, v.Tone = "is overdue", left+" left to pay. It was due "+due+".", "warning"
		v.Lead = []string{owed + ". Please pay it online as soon as you can, " + payHow}
		v.Details = []row{{Label: "Due date", Value: due}}
	}
	v.Subject, v.Title = "Reminder: "+who+" "+is, number+" "+is
	if network == "" {
		network = "You choose on the payment page"
	}
	v.Details = append(v.Details, row{Label: "Network", Value: network})
	v.Reason = by + " turned on payment reminders for this invoice: at most 3, and none once it’s paid."
	if replyTo != "" {
		v.Reason += " Reply to this email to reach them."
	}
	return v
}

// message is the email for a view: the designed HTML part and a plain text part with the same words and links.
func message(site Site, v view) (email.Message, error) {
	html, err := render(site, v)
	if err != nil {
		return email.Message{}, err
	}
	text := v.Title + "\n"
	if v.TestMode != "" {
		text = v.TestMode + "\n\n" + text
	}
	if v.Amount != "" {
		text += v.Amount + "\n"
	}
	text += "\n" + strings.Join(v.Lead, "\n\n")
	if len(v.Details) > 0 {
		text += "\n"
		for _, d := range v.Details {
			value := d.Value
			if d.Href != "" {
				value = d.Href
			}
			text += "\n" + d.Label + ": " + value
		}
	}
	if v.Note != "" {
		text += "\n\n" + v.Note
	}
	text += "\n\n" + v.Button.Label + ": " + v.Button.URL
	if v.Link.URL != "" {
		text += "\n" + v.Link.Label + ": " + v.Link.URL
	}
	text += "\n\n" + v.Reason
	if v.Settings != "" {
		text += " Email settings: " + v.Settings
	}
	if v.Stop != "" {
		text += " Stop reminders: " + v.Stop
	}
	if site.Support != "" {
		text += "\nQuestions? " + site.Support
	}
	text += "\nForwend: " + site.WebURL + "\n"
	if site.PostalAddress != "" {
		text += site.PostalAddress + "\n"
	}
	return email.Message{Subject: v.Subject, Text: text, HTML: html, ReplyTo: v.ReplyTo, Unsubscribe: v.Unsubscribe}, nil
}
