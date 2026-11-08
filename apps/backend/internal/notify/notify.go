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
		if err := tx.QueryRow(ctx, "SELECT login_email FROM users WHERE id = $1", user).Scan(&to); err != nil {
			return false, fmt.Errorf("read email event %d user: %w", id, err)
		}
	case outbox.Change:
		scope = "job-" + job
		if v, to, on, err = changeEmail(ctx, tx, job, payload, site.WebURL); err != nil {
			return false, fmt.Errorf("read email event %d: %w", id, err)
		}
	case outbox.Invite:
		scope = "invite-" + invite
		if v, to, on, err = inviteEmail(ctx, tx, invite, payload, site.WebURL); err != nil {
			return false, fmt.Errorf("read email event %d: %w", id, err)
		}
	case outbox.WalletOutflow:
		// About the owner's money: the profile's email setting doesn't apply.
		on, scope = true, fmt.Sprintf("outflow-%d", transfer)
		var symbol, counterparty, hash, amount string
		var decimals int
		var chainID uint64
		if err := tx.QueryRow(ctx, `SELECT u.login_email, t.symbol, t.decimals, w.chain_id, w.counterparty, w.tx_hash,
			    w.amount::text
			FROM wallet_transfers w JOIN profile_wallets pw ON pw.address = w.wallet_address
			JOIN profiles p ON p.id = pw.profile_id JOIN users u ON u.id = p.user_id
			JOIN tokens t ON t.chain_id = w.chain_id AND t.contract = w.token_contract WHERE w.id = $1`, transfer).
			Scan(&to, &symbol, &decimals, &chainID, &counterparty, &hash, &amount); err != nil {
			return false, fmt.Errorf("read email event %d transfer: %w", id, err)
		}
		units, _ := new(big.Int).SetString(amount, 10)
		v = outflow(document.Amount(units, decimals, symbol), counterparty, document.NetworkName(chainID),
			document.TxURL(chainID, hash), site.WebURL+"/app/settings")
	case outbox.SettleWaiting:
		// About the account's settlements, so the profile's email setting doesn't apply.
		on, scope, v = true, "waiting-"+invoice, waiting(site.WebURL+"/app/transactions")
		if err := tx.QueryRow(ctx, `SELECT u.login_email FROM invoices i JOIN profiles p ON p.id = i.profile_id
			JOIN users u ON u.id = p.user_id WHERE i.id = $1`, invoice).Scan(&to); err != nil {
			return false, fmt.Errorf("read email event %d owner: %w", id, err)
		}
	case outbox.WebhookDisabled:
		scope = "endpoint-" + endpoint
		if v, to, on, err = disabledEmail(ctx, tx, endpoint, payload, site.WebURL); err != nil {
			return false, fmt.Errorf("read email event %d: %w", id, err)
		}
	default:
		scope = invoice
		if v, to, on, err = invoiceEmail(ctx, tx, kind, invoice, payload, site.WebURL); err != nil {
			return false, fmt.Errorf("read email event %d: %w", id, err)
		}
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
		return false, fmt.Errorf("render email event %d: %w", id, err)
	}
	m.To = *to
	sum := sha256.Sum256(fmt.Appendf(nil, "%q|%q|%q|%q|%q|%q", m.To, m.Subject, m.Text, m.HTML, m.ReplyTo, m.Unsubscribe))
	m.Key = fmt.Sprintf("forwend-%s-%d-%x", scope, id, sum[:8])
	if sent := sender.Send(ctx, m); sent != nil {
		attempts++
		if attempts >= MaxAttempts {
			slog.Error("email given up", "event", id, "kind", kind, "attempts", attempts, "err", sent)
			_, err = tx.Exec(ctx, "UPDATE outbox_events SET attempts = $2, failed_at = now(), "+dropToken+" WHERE id = $1",
				id, attempts)
			if err == nil {
				err = addHistory(ctx, tx, kind, invoice, payload, true)
			}
		} else {
			slog.Warn("email failed; trying again later", "event", id, "kind", kind, "attempt", attempts, "err", sent)
			_, err = tx.Exec(ctx, "UPDATE outbox_events SET attempts = $2, next_attempt_at = now() + $3 WHERE id = $1",
				id, attempts, Backoff(attempts))
		}
		if err != nil {
			return false, fmt.Errorf("record email event %d failure: %w", id, err)
		}
		// A refused message goes on to the next: one bad address must not hold up every email behind it (R-115). Any
		// other failure stops the round, so a failing or hanging Resend doesn't hold up the worker's chain rounds.
		return errors.Is(sent, email.ErrRefused), tx.Commit(ctx)
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
	)
	if err := tx.QueryRow(ctx, `SELECT p.email_notifications, u.login_email, m.payer_email, m.number,
		    coalesce(m.issuer_name, ''), coalesce(m.sender_name, ''), t.symbol, t.decimals, o.chain_id, o.amount::text,
		    coalesce((SELECT d.tx_hash FROM chain_transfers d
		              JOIN ledger_transactions x ON x.chain_transfer_id = d.id AND x.kind IN ('deposit', 'reopen')
		              JOIN ledger_entries e ON e.transaction_id = x.id AND e.account = 'recipient_payable'
		              WHERE d.invoice_id = o.id ORDER BY d.block_number DESC, d.log_index DESC LIMIT 1), ''),
		    coalesce(m.client_email, ''), coalesce(m.issuer_email, ''), coalesce(m.due_date::text, ''),
		    (SELECT count(*) FROM invoices x WHERE coalesce(x.main_id, x.id) = m.id), coalesce(m.pay_token, ''),
		    (SELECT livemode FROM chains c WHERE c.chain_id = o.chain_id)
		FROM invoices m JOIN profiles p ON p.id = m.profile_id JOIN users u ON u.id = p.user_id
		JOIN invoices o ON o.id = $2 JOIN tokens t ON t.chain_id = o.chain_id AND t.contract = o.token_contract
		WHERE m.id = $1`, invoice, p.Option).Scan(&on, &to, &payer, &number, &issuer, &typed, &symbol, &decimals, &chainID,
		&amount, &hash, &client, &replyTo, &due, &options, &pay, &live); err != nil {
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
		v = receipt(reference, document.Amount(units, decimals, symbol), symbol, document.NetworkName(chainID), issuer, typed,
			document.TxURL(chainID, hash), webURL+"/api/v1/invoices/"+pay+"/receipt.pdf")
	} else {
		v = compose(kind, reference, document.Amount(units, decimals, symbol), symbol, document.NetworkName(chainID),
			ownerURL, webURL+"/app/notifications")
		if number == nil {
			v.Button.Label = "View payment"
		}
	}
	if number == nil {
		v.Details[0].Label = "Payment"
	}
	// The payer's receipt and the owner's own emails say test mode too: testnet tokens never read as real money.
	return marked(v, live), to, on, nil
}

func compose(kind, number, amount, symbol, network, link, settings string) view {
	v := view{Amount: amount, Tone: "success", Button: button{"View invoice", link},
		Details: []row{{Label: "Invoice", Value: number}, {Label: "Network", Value: network}, {Label: "Token", Value: symbol}},
		Reason:  "You get this email because email is on for this profile.", Settings: settings}
	switch kind {
	case outbox.Paid:
		v.Subject, v.Badge, v.Title = number+" paid: "+amount, "Paid", number+" was paid"
		v.Lead = []string{number + " was paid: " + amount + " on " + network + ". Forwend sends it to your wallet next."}
	case outbox.Settled:
		v.Subject, v.Badge, v.Title = number+": "+amount+" is in your wallet", "In your wallet", "The money is in your wallet"
		v.Lead = []string{"The payment for " + number + " reached your wallet: " + amount + " on " + network + "."}
	default: // outbox.Held
		v.Subject, v.Badge, v.Tone, v.Title = number+": "+amount+" held for the payer", "Held for the payer", "warning",
			"Money held for the payer"
		v.Lead = []string{amount + " for " + number + " on " + network + " does not pay it: more than the amount, a " +
			"partial payment when the checkout closed, money after it closed or after you canceled it, or money on " +
			"another payment option. It is held for the payer, not paid to you.",
			"Forwend support handles any return to the payer, so you don't need to do anything."}
	}
	v.Preheader = v.Lead[0]
	return v
}

// welcome is a new account's one welcome email (R-84).
func welcome(app string) view {
	return view{Subject: "Welcome to Forwend", Preheader: "Your Forwend account is ready.", Title: "Welcome to Forwend",
		Lead: []string{"Your Forwend account is ready. Create an invoice or a payment request, share its pay link, " +
			"and get paid in stablecoins to your wallet.", "Forwend emails you when an invoice is paid, when the money " +
			"reaches your wallet, and when money is held for a payer. You can turn those emails off for each profile."},
		Button: button{"Open Forwend", app}, Reason: "You get this email once, because you created a Forwend account."}
}

// CodeMessage is the email with a Confirm it's you code (R-137); the api sends it at once, outside the outbox.
func CodeMessage(site Site, code string, ttl time.Duration) (email.Message, error) {
	return message(site, view{Subject: "Your Forwend code: " + code, Preheader: "Use it to confirm it's you.",
		Title: "Confirm it's you", Amount: code,
		// The plain-text part has no large figure, so the code is in the words too.
		Lead: []string{"Your code is " + code + ". Enter it in Forwend to confirm it's you. " +
			fmt.Sprintf("It works for %d minutes.", int(ttl.Minutes()))},
		Note:   "Didn't ask for it? Don't share it. Sign out of all devices in Forwend's Settings.",
		Button: button{"Open Forwend", site.WebURL + "/app"},
		Reason: "You get this email because someone asked to confirm it's you in Forwend."})
}

// receipt is the payer's one email (R-82): nothing else is ever sent to this address.
func receipt(number, amount, symbol, network, issuer, sender, tx, pdf string) view {
	v := view{Subject: "Your receipt for " + number, Badge: "Paid", Tone: "success", Title: "Receipt for " + number,
		Amount: amount, Button: button{"Download receipt (PDF)", pdf}, Details: []row{{Label: "Invoice", Value: number}},
		Reason: "You get this one email because you asked for the receipt on the payment page. Forwend sends nothing " +
			"else to this address."}
	to := ""
	switch {
	case issuer != "":
		to = issuer
	case sender != "":
		// Same wording as the pay page's Need help. An email comes from Forwend, so a typed name says so here; the PDF
		// is the sender's own document and shows the name alone.
		to, v.Note = sender, "The name is what the invoice's creator gave; Forwend doesn't check it."
	}
	if to != "" {
		v.Details = append(v.Details, row{Label: "Paid to", Value: to})
		to = " to " + to
	}
	v.Details = append(v.Details, row{Label: "Network", Value: network}, row{Label: "Token", Value: symbol})
	if tx != "" {
		v.Details = append(v.Details, row{Label: "Transaction", Value: "View on the block explorer", Href: tx})
	}
	v.Lead = []string{"You paid " + amount + " on " + network + to + " for " + number + "."}
	v.Preheader = v.Lead[0]
	return v
}

// marked says an email is about a test-mode invoice (R-143), so testnet tokens never pass for real money.
func marked(v view, live bool) view {
	if !live {
		v.Lead = append(v.Lead, document.TestMode+".")
	}
	return v
}

// sent is the invoice email to the client (R-94); network is empty when the client chooses.
func sent(number, amount, network, issuer, sender, due, replyTo, pay, pdf string) view {
	v := view{Subject: "Invoice " + number, Badge: "Invoice", Tone: "neutral", Title: "Invoice " + number,
		Amount: amount, Button: button{"View and pay", pay}, ReplyTo: replyTo, Details: []row{{Label: "Invoice", Value: number}}}
	from := issuer
	if from == "" && sender != "" {
		from, v.Note = sender, "The name is what the invoice's creator gave; Forwend doesn't check it."
	}
	v.Lead = []string{"You have invoice " + number + " for " + amount + "."}
	v.Reason = "You get this email because someone sent you this invoice through Forwend."
	if from != "" {
		v.Subject += " from " + from
		v.Details = append(v.Details, row{Label: "From", Value: from})
		v.Lead[0] = from + " sent you " + number + " for " + amount + "."
		v.Reason = "You get this email because " + from + " sent you this invoice through Forwend."
	}
	v.Lead[0] += " You pay it in stablecoins on the payment page."
	if due != "" {
		v.Details = append(v.Details, row{Label: "Due date", Value: due})
	}
	if network == "" {
		network = "You choose on the payment page"
	}
	v.Details = append(v.Details, row{Label: "Network", Value: network},
		row{Label: "Invoice PDF", Value: "Download the invoice (PDF)", Href: pdf})
	if replyTo != "" {
		v.Reason += " Reply to this email to reach them."
	}
	v.Preheader = v.Lead[0]
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
	what := amount + " left your wallet on " + network + " to " + to + ", without a send you approved in Forwend."
	v := view{Subject: "Money left your wallet", Preheader: what, Badge: "Check this", Tone: "warning",
		Title: "Money left your wallet", Button: button{"Open Account and security", link},
		Lead: []string{what, "If you moved it yourself, for example from another wallet app, nothing is wrong. If " +
			"you didn't, sign out of all devices now and contact support."},
		Details: []row{{Label: "Amount", Value: amount}, {Label: "To", Value: to}, {Label: "Network", Value: network}},
		Reason:  "You get this email because money left one of your Forwend wallets."}
	if tx != "" {
		v.Details = append(v.Details, row{Label: "Transaction", Value: "View on the block explorer", Href: tx})
	}
	return v
}

// waiting tells the owner their paid invoices wait on the day's sponsored settlements (SEC-03).
func waiting(link string) view {
	why := "You were paid for more invoices in 24 hours than Forwend settles to your wallets in a day. The rest wait " +
		"at their receive addresses and settle as the day's limit frees up."
	return view{Subject: "Some payments are waiting to settle", Preheader: why, Badge: "Waiting", Tone: "warning",
		Title: "Some payments are waiting to settle", Button: button{"Open Transactions", link},
		Lead: []string{why, "The money is safe. If payments keep coming at this pace, contact support so a payment " +
			"isn't left waiting past its settle deadline."},
		Reason: "You get this email because payments to your profiles are waiting to settle."}
}

// disabled names only the endpoint's host: its path or query may hold the receiver's own token.
func disabled(host, reason, link string) view {
	why := "Forwend could not deliver an event to " + host + " for about 3 days, so it stopped sending events there."
	if reason == webhook.Gone {
		why = host + " answered 410 Gone, so Forwend stopped sending events there."
	}
	return view{Subject: "Webhook endpoint turned off: " + host, Preheader: why, Badge: "Turned off", Tone: "warning",
		Title: "A webhook endpoint was turned off", Button: button{"Open Developers", link},
		Lead: []string{why, "Fix the endpoint, then turn it on again on the Developers page. Events from while it " +
			"was off are not sent to it."},
		Details: []row{{Label: "Endpoint", Value: host}},
		Reason:  "You get this email because a webhook endpoint of your profile was turned off."}
}

var roleNames = map[string]string{"admin": "Admin", "developer": "Developer", "finance": "Finance"}

// invitation is a team invite's email to the address invited (R-139).
func invitation(team, role, replyTo, link string) view {
	lead := "You are invited to join " + team + " on Forwend as " + role + "."
	return view{Subject: "Join " + team + " on Forwend", Preheader: lead, Badge: "Invite", Tone: "neutral",
		Title: "Join " + team, Button: button{"Accept the invite", link}, ReplyTo: replyTo,
		Lead:    []string{lead, "Sign in to Forwend with this email address to accept. The link works for 7 days, once."},
		Details: []row{{Label: "Team", Value: team}, {Label: "Role", Value: role}},
		Reason: "You get this email because a member of " + team + " invited this address. If you did not expect it, " +
			"ignore it: nothing happens until you accept."}
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
	lead := issuer + " proposed a change to " + job + ": " + title + " for " + amount + "."
	return view{Subject: "A change to " + job + " from " + issuer, Preheader: lead, Badge: "Change", Tone: "neutral",
		Title: "A change to " + job, Amount: amount, Button: button{"Review the change", link}, ReplyTo: replyTo,
		Lead:    []string{lead, "It is billed only if you accept it: its invoice comes when the work is done, " + due + "."},
		Details: []row{{Label: "Job", Value: job}, {Label: "Change", Value: title}, {Label: "From", Value: issuer}},
		Reason: "You get this email because you accepted " + issuer + "'s quote for " + job + " through Forwend. " +
			"Reply to this email to reach them."}
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
	v := view{Badge: "Reminder", Tone: "neutral", Amount: left, Button: button{"View and pay", pay}, ReplyTo: replyTo,
		Details: []row{{Label: "Invoice", Value: number}}}
	from := issuer
	if from == "" && sender != "" {
		from, v.Note = sender, "The name is what the invoice's creator gave; Forwend doesn't check it."
	}
	who := "This is a reminder that " + number
	if from != "" {
		v.Details = append(v.Details, row{Label: "From", Value: from})
		who = from + " reminds you that " + number
	}
	switch step {
	case invoice.ReminderBefore:
		v.Subject, v.Title = "Reminder: "+number+" is due on "+due, number+" is due on "+due
		v.Lead = []string{who + " is due on " + due + ": " + left + " left to pay."}
	case invoice.ReminderDue:
		v.Subject, v.Title = "Reminder: "+number+" is due today", number+" is due today"
		v.Lead = []string{who + " is due today, " + due + ": " + left + " left to pay."}
	default: // invoice.ReminderAfter
		v.Subject, v.Title, v.Tone = "Reminder: "+number+" is overdue", number+" is overdue", "warning"
		v.Lead = []string{who + " was due on " + due + ": " + left + " left to pay."}
	}
	if from != "" {
		v.Subject += " (" + from + ")"
	}
	if network == "" {
		network = "You choose on the payment page"
	}
	v.Details = append(v.Details, row{Label: "Due date", Value: due}, row{Label: "Network", Value: network},
		row{Label: "Invoice PDF", Value: "Download the invoice (PDF)", Href: pdf})
	v.Lead[0] += " You pay it in stablecoins on the payment page."
	v.Reason = "You get this reminder because the sender turned on payment reminders for this invoice. At most 3 are " +
		"sent, and none once it is paid."
	if replyTo != "" {
		v.Reason += " Reply to this email to reach them."
	}
	v.Preheader = v.Lead[0]
	return v
}

// message is the email for a view: the designed HTML part and a plain text part with the same words and links.
func message(site Site, v view) (email.Message, error) {
	html, err := render(site, v)
	if err != nil {
		return email.Message{}, err
	}
	text := strings.Join(v.Lead, "\n\n")
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
	text += "\n\n" + v.Button.Label + ": " + v.Button.URL + "\n\n" + v.Reason
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
