package notify

import (
	"fmt"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/forwend/forwend/apps/backend/internal/document"
	"github.com/forwend/forwend/apps/backend/internal/email"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/outbox"
	"github.com/forwend/forwend/apps/backend/internal/webhook"
)

// compose is the owner's email about their invoice's money: paid, settled, or held for the payer.
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

var roleNames = map[auth.Role]string{auth.Admin: "Admin", auth.Developer: "Developer", auth.Finance: "Finance"}

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
