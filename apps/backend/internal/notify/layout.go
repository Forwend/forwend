package notify

import (
	"bytes"
	_ "embed"
	"html/template"
	"regexp"
	"strings"

	"github.com/forwend/forwend/apps/backend/internal/email"
)

// Site's WebURL is the web app's origin; an empty PostalAddress or Support is left out of the footer.
type Site struct {
	WebURL, PostalAddress, Support string
}

//go:embed layout.html.tmpl
var layoutHTML string

// html/template escapes every value, so a name the invoice's creator typed can't inject markup.
var layout = template.Must(template.New("email").Funcs(template.FuncMap{"keep": keep}).Parse(layoutHTML))

const logo = "/email/logo-mark.png"

// together finds an invoice number, a date ("30 Nov 2026") and an amount ("1,250.00 USDC").
var together = regexp.MustCompile(`INV-\d+|\d{1,2} [A-Z][a-z]{2} \d{4}|\d[\d,]*(?:\.\d+)? [A-Z][A-Z0-9]*`)

// keep escapes s and stops a narrow screen from splitting an invoice number, a date or an amount.
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

type view struct {
	Subject, Preheader string
	TestMode           string // shown first on test-mode emails
	Tone               string // "", success or warning
	Title, Amount      string
	Lead               []string
	Details            []row
	Note               string
	Button, Link       button // Link is optional, a plain link under the button
	Reason, Settings   string
	ReplyTo            string // "" = Forwend's From address
	Stop, Unsubscribe  string // reminders stop page; RFC 8058 one-click URL
}

func render(site Site, v view) (string, error) {
	var b bytes.Buffer
	data := struct {
		view
		Site, Logo, Support, Postal string
	}{v, site.WebURL, site.WebURL + logo, site.Support, site.PostalAddress}
	err := layout.Execute(&b, data)
	return b.String(), err
}

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
