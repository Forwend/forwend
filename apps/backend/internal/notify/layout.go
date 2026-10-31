package notify

import (
	"bytes"
	_ "embed"
	"html/template"
	"regexp"
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

var invoiceNumber = regexp.MustCompile(`INV-\d+`)

// keep escapes s and keeps each invoice number on one line: a narrow screen must not split "INV-" from "0001".
func keep(s string) template.HTML {
	return template.HTML(invoiceNumber.ReplaceAllString(template.HTMLEscapeString(s),
		`<span style="white-space:nowrap">$0</span>`))
}

type row struct{ Label, Value, Href string }

type button struct{ Label, URL string }

// Tone colors the badge: success, warning or neutral.
type view struct {
	Subject, Preheader string
	Badge, Tone        string
	Title, Amount      string
	Lead               []string
	Details            []row
	Note               string
	Button             button
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
	}{v, site.WebURL, site.WebURL + "/icon-192.png", site.Support, site.PostalAddress}
	err := layout.Execute(&b, data)
	return b.String(), err
}
