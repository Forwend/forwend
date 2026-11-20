package notify

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"net/url"
	"strconv"

	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/forwend/forwend/apps/backend/internal/document"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/forwend/forwend/apps/backend/internal/outbox"
	"github.com/forwend/forwend/apps/backend/internal/team"
	"github.com/jackc/pgx/v5"
)

// read is an event's email: its view, its address (nil or "" for none), whether it goes, and its key's subject.
func read(ctx context.Context, tx pgx.Tx, e event, webURL string) (v view, to *string, on bool, scope string,
	err error) {
	var reader func(context.Context, pgx.Tx, event, string) (view, *string, bool, error)
	switch e.kind {
	case outbox.Welcome:
		scope, reader = "user-"+e.user, welcomeEmail
	case outbox.Change:
		scope, reader = "job-"+e.job, changeEmail
	case outbox.Invite:
		scope, reader = "invite-"+e.invite, inviteEmail
	case outbox.WalletOutflow:
		scope, reader = fmt.Sprintf("outflow-%d", e.transfer), outflowEmail
	case outbox.SettleWaiting:
		scope, reader = "waiting-"+e.invoice, waitingEmail
	case outbox.RetainerFailed:
		scope, reader = "retainer-"+e.invoice, retainerEmail
	case outbox.WebhookDisabled:
		scope, reader = "endpoint-"+e.endpoint, disabledEmail
	default:
		scope, reader = e.invoice, invoiceEmail
	}
	v, to, on, err = reader(ctx, tx, e, webURL)
	return v, to, on, scope, err
}

// welcomeEmail is about the account, not a profile's invoices: the profile's email setting doesn't apply.
func welcomeEmail(ctx context.Context, tx pgx.Tx, e event, webURL string) (view, *string, bool, error) {
	var to *string
	if err := tx.QueryRow(ctx, "SELECT login_email FROM users WHERE id = $1", e.user).Scan(&to); err != nil {
		return view{}, nil, false, fmt.Errorf("user: %w", err)
	}
	return welcome(webURL + "/app"), to, true, nil
}

// outflowEmail is about the owner's money: the profile's email setting doesn't apply.
func outflowEmail(ctx context.Context, tx pgx.Tx, e event, webURL string) (view, *string, bool, error) {
	var to *string
	var symbol, counterparty, hash, amount string
	var decimals int
	var chainID uint64
	if err := tx.QueryRow(ctx, `SELECT u.login_email, t.symbol, t.decimals, w.chain_id, w.counterparty, w.tx_hash,
		    w.amount::text
		FROM wallet_transfers w JOIN profile_wallets pw ON pw.address = w.wallet_address
		JOIN profiles p ON p.id = pw.profile_id JOIN users u ON u.id = p.user_id
		JOIN tokens t ON t.chain_id = w.chain_id AND t.contract = w.token_contract WHERE w.id = $1`, e.transfer).
		Scan(&to, &symbol, &decimals, &chainID, &counterparty, &hash, &amount); err != nil {
		return view{}, nil, false, fmt.Errorf("transfer: %w", err)
	}
	units, _ := new(big.Int).SetString(amount, 10)
	return outflow(document.Amount(units, decimals, symbol), counterparty, document.NetworkName(chainID),
		document.TxURL(chainID, hash), webURL+"/app/settings"), to, true, nil
}

// waitingEmail is about the account's settlements, so the profile's email setting doesn't apply.
func waitingEmail(ctx context.Context, tx pgx.Tx, e event, webURL string) (view, *string, bool, error) {
	var to *string
	if err := tx.QueryRow(ctx, `SELECT u.login_email FROM invoices i JOIN profiles p ON p.id = i.profile_id
		JOIN users u ON u.id = p.user_id WHERE i.id = $1`, e.invoice).Scan(&to); err != nil {
		return view{}, nil, false, fmt.Errorf("owner: %w", err)
	}
	return waiting(webURL + "/app/transactions"), to, true, nil
}

// retainerEmail is about the owner's own billing, so the profile's email setting doesn't apply.
func retainerEmail(ctx context.Context, tx pgx.Tx, e event, webURL string) (view, *string, bool, error) {
	var to *string
	var number int64
	var client string
	if err := tx.QueryRow(ctx, `SELECT u.login_email, i.number, coalesce(i.client_name, i.client_email, '')
		FROM invoices i JOIN profiles p ON p.id = i.profile_id JOIN users u ON u.id = p.user_id WHERE i.id = $1`,
		e.invoice).Scan(&to, &number, &client); err != nil {
		return view{}, nil, false, fmt.Errorf("invoice: %w", err)
	}
	return retainerFailed(document.Number(number), client, document.DateText(e.payload.Due),
		webURL+"/app/invoices/"+e.invoice), to, true, nil
}

// invoiceEmail goes to the owner when email is on, to the payer for a receipt, and to the client for a send.
func invoiceEmail(ctx context.Context, tx pgx.Tx, e event, webURL string) (view, *string, bool, error) {
	p := e.payload
	if e.kind == outbox.Reminder {
		return reminderEmail(ctx, tx, e.invoice, p, webURL)
	}
	var (
		on                   bool
		to, payer            *string
		number               *int64
		symbol, amount, hash string
		issuer, typed        string
		client, replyTo, due string
		pay                  string // the pay link's token
		decimals, options    int
		chainID              uint64
		live                 bool
		paidWith             []string // a payment through NEAR Intents: symbol, chain, amount sent, decimals
	)
	if err := tx.QueryRow(ctx, `SELECT p.email_notifications, u.login_email, m.payer_email, m.number,
		    coalesce(m.issuer_name, ''), coalesce(m.sender_name, ''), t.symbol, t.decimals, o.chain_id, o.amount::text,
		    coalesce((SELECT d.tx_hash FROM chain_transfers d
		              JOIN ledger_transactions x ON x.chain_transfer_id = d.id AND x.kind IN `+ledger.DepositKindsSQL+`
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
		WHERE m.id = $1`, e.invoice, p.Option).Scan(&on, &to, &payer, &number, &issuer, &typed, &symbol, &decimals,
		&chainID, &amount, &hash, &client, &replyTo, &due, &options, &pay, &live, &paidWith); err != nil {
		return view{}, nil, false, fmt.Errorf("invoice: %w", err)
	}
	// An invoice without a pay token has no pay link: the client's and the payer's emails would link nowhere.
	if pay == "" && (e.kind == outbox.Sent || e.kind == outbox.Receipt) {
		return view{}, nil, false, nil
	}
	// The payer's receipt goes to the address they gave, whatever the owner's setting.
	if e.kind == outbox.Receipt {
		on, to = true, payer
	}
	if p.Amount != "" {
		amount = p.Amount
	}
	units, _ := new(big.Int).SetString(amount, 10)
	reference := "Payment " + e.invoice[2:14]
	ownerURL := webURL + "/app/payments/" + e.invoice
	if number != nil {
		reference = document.Number(*number)
		ownerURL = webURL + "/app/invoices/" + e.invoice
	}
	if e.kind == outbox.Sent {
		// The owner sent it, so the owner's setting doesn't apply.
		network := document.NetworkName(chainID)
		if options > 1 { // the client chooses the token and network, each at 1 USD
			symbol, network = "USD", ""
		}
		return marked(sent(reference, document.Amount(units, decimals, symbol), network, issuer, typed,
				document.DateText(due), replyTo, invoice.PayURL(webURL, pay), webURL+"/api/v1/invoices/"+pay+"/invoice.pdf"), live),
			&client, true, nil
	}
	var v view
	if e.kind == outbox.Receipt {
		v = receipt(reference, document.Amount(units, decimals, symbol), document.NetworkName(chainID), issuer, typed,
			document.TxURL(chainID, hash), webURL+"/api/v1/invoices/"+pay+"/receipt.pdf")
	} else {
		v = compose(e.kind, reference, document.Amount(units, decimals, symbol), document.NetworkName(chainID), ownerURL,
			webURL+"/app/notifications")
		if number == nil {
			v.Button.Label = "View payment"
		}
	}
	if len(paidWith) == 4 && (e.kind == outbox.Receipt || e.kind == outbox.Paid) {
		sent, _ := new(big.Int).SetString(paidWith[2], 10)
		places, _ := strconv.Atoi(paidWith[3])
		v.Details = append(v.Details, row{Label: "Paid with",
			Value: document.PaidWith(sent, places, paidWith[0], paidWith[1])})
	}
	// The payer's receipt and the owner's own emails say test mode too: testnet tokens never read as real money.
	return marked(v, live), to, on, nil
}

// reminderEmail sends only while reminders are on and something is left on an open invoice, checked again now.
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
		    o.chain_id, (o.amount - `+ledger.OwedSQL("o.id")+`)::text,
		    (SELECT count(*) FROM invoices c WHERE c.id = m.id OR c.main_id = m.id), m.chosen_id IS NOT NULL, r.stop_token,
		    coalesce(m.pay_token, ''), (SELECT livemode FROM chains c WHERE c.chain_id = o.chain_id)
		FROM invoices m JOIN invoice_reminders r ON r.invoice_id = m.id JOIN invoices o ON o.id = $2
		JOIN tokens t ON t.chain_id = o.chain_id AND t.contract = o.token_contract
		WHERE m.id = $1`, id, p.Option).Scan(&on, &to, &issuer, &sender, &replyTo, &due, &number, &symbol, &decimals,
		&chainID, &left, &options, &locked, &token, &pay, &live); err != nil {
		return view{}, nil, false, fmt.Errorf("reminder: %w", err)
	}
	units, _ := new(big.Int).SetString(left, 10)
	if units.Sign() <= 0 || pay == "" {
		on = false
	}
	network := document.NetworkName(chainID)
	if options > 1 && !locked { // the client still chooses the token and network, each at 1 USD
		symbol, network = "USD", ""
	}
	v := marked(reminder(p.Step, document.Number(number), document.Amount(units, decimals, symbol), network, issuer, sender,
		document.DateText(due), replyTo, invoice.PayURL(webURL, pay), webURL+"/api/v1/invoices/"+pay+"/invoice.pdf"), live)
	v.Stop, v.Unsubscribe = webURL+"/reminders/"+token, webURL+"/api/v1/reminders/"+token+"/stop"
	return v, &to, on, nil
}

// changeEmail sends only while the change still waits for the client.
func changeEmail(ctx context.Context, tx pgx.Tx, e event, webURL string) (view, *string, bool, error) {
	var (
		to                                   *string
		title, token, issuer, replyTo, named string
		cents                                int64
		days                                 int
	)
	err := tx.QueryRow(ctx, `SELECT j.accepted_email, j.title, j.token, j.issuer_name, j.issuer_email, c.title,
		    c.amount_cents, c.due_days
		FROM jobs j JOIN job_payments c ON c.job_id = j.id
		WHERE j.id = $1 AND c.change_key = $2 AND c.accepted_at IS NULL`, e.job, e.payload.Change).Scan(&to, &title, &token,
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
func inviteEmail(ctx context.Context, tx pgx.Tx, e event, webURL string) (view, *string, bool, error) {
	var to, name, replyTo string
	var role auth.Role
	err := tx.QueryRow(ctx, `SELECT i.email, coalesce(p.name, ''), i.role, coalesce(u.login_email, '')
		FROM profile_invites i JOIN profiles p ON p.id = i.profile_id JOIN users u ON u.id = i.invited_by
		WHERE i.id = $1 AND `+team.OpenInviteSQL, e.invite).
		Scan(&to, &name, &role, &replyTo)
	if errors.Is(err, pgx.ErrNoRows) {
		return view{}, nil, false, nil
	} else if err != nil {
		return view{}, nil, false, fmt.Errorf("team invite: %w", err)
	}
	return invitation(name, roleNames[role], replyTo, webURL+"/invite/"+e.payload.Token), &to, true, nil
}

// disabledEmail goes to the profile owner whatever their email setting: nothing else says deliveries stopped.
func disabledEmail(ctx context.Context, tx pgx.Tx, e event, webURL string) (view, *string, bool, error) {
	var to *string
	var raw string
	if err := tx.QueryRow(ctx, `SELECT u.login_email, w.url FROM webhook_endpoints w
		JOIN profiles p ON p.id = w.profile_id JOIN users u ON u.id = p.user_id WHERE w.id = $1`, e.endpoint).
		Scan(&to, &raw); err != nil {
		return view{}, nil, false, fmt.Errorf("webhook endpoint: %w", err)
	}
	u, _ := url.Parse(raw) // saved only once it parsed
	return disabled(u.Hostname(), e.payload.Reason, webURL+"/app/developers"), to, true, nil
}
