// Package notify sends the email for each outbox event: the owner's paid, settled and held-money emails (R-80), the
// payer's receipt (R-82), a new account's welcome (R-84), the invoice the owner sends to the client (R-94), the
// client's payment reminders (R-96) and a job's scope changes (R-107).
// One worker claims each event once (FOR UPDATE SKIP LOCKED); invoice, user or job, event id and address make Resend's
// Idempotency-Key, the same on every retry, so a retry after a lost answer sends nothing twice. Nothing logs an address, a subject or a body.
package notify

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"strings"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/document"
	"github.com/ensp1re/forwend/apps/backend/internal/email"
	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/outbox"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MaxAttempts: after this many failed sends the event is given up. With Backoff that ends within a few hours, inside
// Resend's 24-hour idempotency window.
const MaxAttempts = 10

// Batch bounds the events one call sends, so a backlog never holds up the worker's chain rounds.
const Batch = 20

// Backoff is the wait after the n-th failed send: 1 min doubling, at most 1 h.
func Backoff(n int) time.Duration {
	return min(time.Minute<<min(n-1, 6), time.Hour)
}

// Deliver sends up to Batch due events.
func Deliver(ctx context.Context, pool *pgxpool.Pool, sender email.Sender, site Site) error {
	for range Batch {
		more, err := deliverOne(ctx, pool, sender, site)
		if err != nil || !more {
			return err
		}
	}
	return nil
}

// deliverOne sends the oldest due event; false when none is due.
func deliverOne(ctx context.Context, pool *pgxpool.Pool, sender email.Sender, site Site) (bool, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("deliver email: %w", err)
	}
	defer tx.Rollback(ctx)
	var (
		id                       int64
		kind, invoice, user, job string
		payload                  []byte
		attempts                 int
	)
	err = tx.QueryRow(ctx, `SELECT id, kind, coalesce(invoice_id, ''), coalesce(user_id::text, ''),
		    coalesce(job_id::text, ''), payload, attempts
		FROM outbox_events WHERE published_at IS NULL AND failed_at IS NULL AND next_attempt_at <= now()
		ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`).Scan(&id, &kind, &invoice, &user, &job, &payload, &attempts)
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
	default:
		scope = invoice
		if v, to, on, err = invoiceEmail(ctx, tx, kind, invoice, payload, site.WebURL); err != nil {
			return false, fmt.Errorf("read email event %d: %w", id, err)
		}
	}
	if !on || to == nil || *to == "" {
		// Email off for this profile, or no login email ('' when the account has none; NULL when it was never read):
		// nothing to send, and nothing waits for it.
		if _, err := tx.Exec(ctx, "UPDATE outbox_events SET published_at = now() WHERE id = $1", id); err != nil {
			return false, fmt.Errorf("skip email event %d: %w", id, err)
		}
		return true, tx.Commit(ctx)
	}
	// The invoice, user or job id too: event ids start again in another database (a reset, staging) that may share the
	// Resend team. And the address: a receipt sent again to a changed address is a new request, which Resend would
	// refuse under a key it already saw with another body.
	m, err := message(site, v)
	if err != nil {
		return false, fmt.Errorf("render email event %d: %w", id, err)
	}
	sum := sha256.Sum256([]byte(*to))
	m.To, m.Key = *to, fmt.Sprintf("forwend-%s-%d-%x", scope, id, sum[:8])
	if sent := sender.Send(ctx, m); sent != nil {
		attempts++
		if attempts >= MaxAttempts {
			slog.Error("email given up", "event", id, "kind", kind, "attempts", attempts, "err", sent)
			_, err = tx.Exec(ctx, "UPDATE outbox_events SET attempts = $2, failed_at = now() WHERE id = $1", id, attempts)
		} else {
			slog.Warn("email failed; trying again later", "event", id, "kind", kind, "attempt", attempts, "err", sent)
			_, err = tx.Exec(ctx, "UPDATE outbox_events SET attempts = $2, next_attempt_at = now() + $3 WHERE id = $1",
				id, attempts, Backoff(attempts))
		}
		if err != nil {
			return false, fmt.Errorf("record email event %d failure: %w", id, err)
		}
		// A message Resend refused goes on to the next one: stopping would let one bad address hold up every email
		// behind it (R-115). Any other failure stops this round: a Resend that fails or hangs must not hold up the
		// worker's chain rounds for a whole batch.
		return errors.Is(sent, email.ErrRefused), tx.Commit(ctx)
	}
	if _, err := tx.Exec(ctx, "UPDATE outbox_events SET attempts = attempts + 1, published_at = now() WHERE id = $1", id); err != nil {
		return false, fmt.Errorf("record email event %d: %w", id, err)
	}
	return true, tx.Commit(ctx)
}

// invoiceEmail builds an invoice event's email and says where it goes: the owner's login email when the profile has
// email on, the payer's address for the receipt, or the client's email for a send.
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
		number               int64
		symbol, amount, hash string
		issuer, typed        string
		client, replyTo, due string
		pay                  string // the pay link's token (D-86)
		decimals, options    int
		chainID              uint64
	)
	if err := tx.QueryRow(ctx, `SELECT p.email_notifications, u.login_email, m.payer_email, m.number,
		    coalesce(m.issuer_name, ''), coalesce(m.sender_name, ''), t.symbol, t.decimals, o.chain_id, o.amount::text,
		    coalesce((SELECT d.tx_hash FROM chain_transfers d
		              JOIN ledger_transactions x ON x.chain_transfer_id = d.id AND x.kind = 'deposit'
		              JOIN ledger_entries e ON e.transaction_id = x.id AND e.account = 'recipient_payable'
		              WHERE d.invoice_id = o.id ORDER BY d.block_number DESC, d.log_index DESC LIMIT 1), ''),
		    coalesce(m.client_email, ''), coalesce(m.issuer_email, ''), coalesce(m.due_date::text, ''),
		    (SELECT count(*) FROM invoices x WHERE coalesce(x.main_id, x.id) = m.id), coalesce(m.pay_token, '')
		FROM invoices m JOIN profiles p ON p.id = m.profile_id JOIN users u ON u.id = p.user_id
		JOIN invoices o ON o.id = $2 JOIN tokens t ON t.chain_id = o.chain_id AND t.contract = o.token_contract
		WHERE m.id = $1`, invoice, p.Option).Scan(&on, &to, &payer, &number, &issuer, &typed, &symbol, &decimals, &chainID,
		&amount, &hash, &client, &replyTo, &due, &options, &pay); err != nil {
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
	if kind == outbox.Sent {
		// The owner sent it, so the owner's setting doesn't apply (R-94).
		network := document.NetworkName(chainID)
		if options > 1 { // the client chooses the token and network, each at 1 USD (D-75)
			symbol, network = "USD", ""
		}
		return sent(document.Number(number), document.Amount(units, decimals, symbol), network, issuer, typed, due,
			replyTo, webURL+"/pay/"+pay, webURL+"/api/v1/invoices/"+pay+"/invoice.pdf"), &client, true, nil
	}
	if kind == outbox.Receipt {
		return receipt(document.Number(number), document.Amount(units, decimals, symbol), symbol, document.NetworkName(chainID), issuer, typed,
			document.TxURL(chainID, hash), webURL+"/api/v1/invoices/"+pay+"/receipt.pdf"), to, on, nil
	}
	return compose(kind, document.Number(number), document.Amount(units, decimals, symbol), symbol, document.NetworkName(chainID),
		webURL+"/app/invoices/"+invoice, webURL+"/app/notifications"), to, on, nil
}

// compose says what happened, with the invoice link and where to turn email off.
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
			"another payment option. It is held for the payer, not paid to you."}
	}
	v.Preheader = v.Lead[0]
	return v
}

// welcome is a new account's one welcome email (R-84): what Forwend does and where to start.
func welcome(app string) view {
	return view{Subject: "Welcome to Forwend", Preheader: "Your Forwend account is ready.", Title: "Welcome to Forwend",
		Lead: []string{"Your Forwend account is ready. Create an invoice or a payment request, share its pay link, " +
			"and get paid in stablecoins to your wallet.", "Forwend emails you when an invoice is paid, when the money " +
			"reaches your wallet, and when money is held for a payer. You can turn those emails off for each profile."},
		Button: button{"Open Forwend", app}, Reason: "You get this email once, because you created a Forwend account."}
}

// receipt is the payer's one email (R-82): what they paid, to whom, the transaction and the receipt PDF. Nothing else
// is ever sent to this address.
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
		// A name the invoice's creator typed, as the pay page and PDF say: not checked by Forwend.
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

// sent is the invoice the owner sends to the client (R-94): who bills them, how much, by when, the pay page and the
// PDF. A reply goes to the issuer's billing email, not to Forwend. network is empty when the client chooses.
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

// changeEmail builds a scope change's email (R-107) for the address the client typed accepting the job. It goes only
// while the change waits for them: checked again now, since the owner may have withdrawn it or the client accepted it.
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

// change tells the client who proposes what change to the job and for how much, with the job's page to accept it
// (R-107).
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

// reminderEmail builds a payment reminder (R-96) for the client's email. It goes only while reminders are on and not
// stopped and something is left to pay on an invoice the payer can still pay: checked again now, since the invoice
// may have been paid or the reminders stopped after the step was queued.
func reminderEmail(ctx context.Context, tx pgx.Tx, id string, p outbox.Payload, webURL string) (view, *string, bool, error) {
	var (
		on, locked                       bool
		to, issuer, sender, replyTo, due string
		symbol, left, token, pay         string
		number                           int64
		decimals, options                int
		chainID                          uint64
	)
	if err := tx.QueryRow(ctx, `SELECT r.enabled AND r.stopped_at IS NULL
		        AND (SELECT `+invoice.StatusFilterSQL+` FROM invoices_current invoices WHERE invoices.id = m.id) = 'open',
		    coalesce(m.client_email, ''), coalesce(m.issuer_name, ''), coalesce(m.sender_name, ''),
		    coalesce(m.issuer_email, ''), coalesce(to_char(m.due_date, 'YYYY-MM-DD'), ''), m.number, t.symbol, t.decimals,
		    o.chain_id, (o.amount + `+invoice.PaidToOwnerSQL("o.id")+`)::text,
		    (SELECT count(*) FROM invoices c WHERE c.id = m.id OR c.main_id = m.id), m.chosen_id IS NOT NULL, r.stop_token,
		    coalesce(m.pay_token, '')
		FROM invoices m JOIN invoice_reminders r ON r.invoice_id = m.id JOIN invoices o ON o.id = $2
		JOIN tokens t ON t.chain_id = o.chain_id AND t.contract = o.token_contract
		WHERE m.id = $1`, id, p.Option).Scan(&on, &to, &issuer, &sender, &replyTo, &due, &number, &symbol, &decimals,
		&chainID, &left, &options, &locked, &token, &pay); err != nil {
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
	v := reminder(p.Step, document.Number(number), document.Amount(units, decimals, symbol), network, issuer, sender, due,
		replyTo, webURL+"/pay/"+pay, webURL+"/api/v1/invoices/"+pay+"/invoice.pdf")
	v.Stop, v.Unsubscribe = webURL+"/reminders/"+token, webURL+"/api/v1/reminders/"+token+"/stop"
	return v, &to, on, nil
}

// reminder says what is left to pay on an invoice and by when, before the due date, on it or after it (R-96). network
// is empty when the client chooses.
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
	text += "\nQuestions? " + Support + "\nForwend: " + site.WebURL + "\n"
	if site.PostalAddress != "" {
		text += site.PostalAddress + "\n"
	}
	return email.Message{Subject: v.Subject, Text: text, HTML: html, ReplyTo: v.ReplyTo, Unsubscribe: v.Unsubscribe}, nil
}
