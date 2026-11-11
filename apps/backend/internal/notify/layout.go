package notify

import (
	"bytes"
	_ "embed"
	"html/template"
	"regexp"
	"strings"
)

// WebURL is the web app's origin (links and the hosted logo); an empty PostalAddress or Support leaves it out of the
// footer.
type Site struct {
	WebURL, PostalAddress, Support string
}

//go:embed layout.html.tmpl
var layoutHTML string

// html/template escapes every value, so a name the invoice's creator typed can't inject markup (F200).
var layout = template.Must(template.New("email").Funcs(template.FuncMap{"keep": keep}).Parse(layoutHTML))

// logo is the email header's mark, served by the web app: a lime tile that reads on light and dark grounds.
const logo = "/email/logo-mark.png"

// together finds an invoice number, a date ("30 Nov 2026") and an amount ("1,250.00 USDC").
var together = regexp.MustCompile(`INV-\d+|\d{1,2} [A-Z][a-z]{2} \d{4}|\d[\d,]*(?:\.\d+)? [A-Z][A-Z0-9]*`)

// keep escapes s and keeps each invoice number, date and amount on one line: a narrow screen must not split "INV-"
// from "0001" or leave "USDC" alone on a line. An amount wider than a phone still breaks, by the paragraph's
// overflow-wrap, where a nowrap span would overflow.
func keep(s string) template.HTML {
	return template.HTML(together.ReplaceAllStringFunc(template.HTMLEscapeString(s), func(m string) string {
		if strings.HasPrefix(m, "INV-") {
			return `<span style="white-space:nowrap">` + m + `</span>`
		}
		return strings.ReplaceAll(m, " ", "&nbsp;")
	}))
}

type row struct{ Label, Value, Href string }

type button struct{ Label, URL string }

// Tone picks the status mark above the title, success or warning; an email with no status to show has none.
type view struct {
	Subject, Preheader string
	TestMode           string // R-143's line, shown first, on a test-mode invoice's emails
	Tone               string
	Title, Amount      string
	Lead               []string
	Details            []row
	Note               string
	Button, Link       button // Link is an optional second action, a plain link under the button
	Reason, Settings   string // why it was sent; the email settings link for owner emails
	ReplyTo            string // where the recipient's reply goes; Forwend's From address when empty
	// Stop is the client's page to stop reminders (R-96), linked in the footer; Unsubscribe is the one-click
	// List-Unsubscribe URL for mail providers.
	Stop, Unsubscribe string
}

// render fills the layout; it fails only on a bug in the template, which the tests render for every kind.
func render(site Site, v view) (string, error) {
	var b bytes.Buffer
	data := struct {
		view
		Site, Logo, Support, Postal string
	}{v, site.WebURL, site.WebURL + logo, site.Support, site.PostalAddress}
	err := layout.Execute(&b, data)
	return b.String(), err
}
