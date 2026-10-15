package notify

import (
	"bytes"
	_ "embed"
	"html/template"
)

// Support is the address every email's footer names.
const Support = "support@forwend.com"

// Site is what every email's layout needs from the deployment: the web app's origin (links and the hosted logo) and
// the sender's postal address for the footer ("" leaves it out).
type Site struct {
	WebURL, PostalAddress string
}

//go:embed layout.html.tmpl
var layoutHTML string

// layout is one designed email for every kind (F200): html/template escapes every value, so a name the invoice's
// creator typed can't inject markup.
var layout = template.Must(template.New("email").Parse(layoutHTML))

type row struct{ Label, Value, Href string }

type button struct{ Label, URL string }

// view is one email's content in the layout. Tone colors the badge: success, warning or neutral.
type view struct {
	Subject, Preheader string
	Badge, Tone        string
	Title, Amount      string
	Lead               []string
	Details            []row
	Note               string
	Button             button
	Reason, Settings   string // why it was sent; the email settings link for owner emails
}

// render fills the layout; it fails only on a bug in the template, which the tests render for every kind.
func render(site Site, v view) (string, error) {
	var b bytes.Buffer
	data := struct {
		view
		Site, Logo, Support, Postal string
	}{v, site.WebURL, site.WebURL + "/icon-192.png", Support, site.PostalAddress}
	err := layout.Execute(&b, data)
	return b.String(), err
}
