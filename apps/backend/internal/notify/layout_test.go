package notify

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/outbox"
)

func samples() map[string]view {
	tx := "https://sepolia.basescan.org/tx/0x" + strings.Repeat("cd", 32)
	link, settings := web+"/app/invoices/0xabc", web+"/app/notifications"
	return map[string]view{
		"paid":          compose(outbox.Paid, "INV-0001", "1,250.00 USDC", "USDC", "Base Sepolia", link, settings),
		"settled":       compose(outbox.Settled, "INV-0001", "1,250.00 USDC", "USDC", "Base Sepolia", link, settings),
		"held":          compose(outbox.Held, "INV-0002", "1.00 USDC", "USDC", "Base Sepolia", link, settings),
		"receipt":       receipt("INV-0001", "1,250.00 USDC", "USDC", "Base Sepolia", "Alice Design GmbH", "", tx, web+"/api/v1/invoices/0xabc/receipt.pdf"),
		"receipt-typed": receipt("INV-0003", "40.00 USDC", "USDC", "Base Sepolia", "", "MaraIlicDesignStudioInvoicesForInternationalClientsLimited", "", web+"/api/v1/invoices/0xdef/receipt.pdf"),
		"welcome":       welcome(web + "/app"),
		"sent": sent("INV-0004", "1,250.00 USDC", "Base Sepolia", "Alice Design GmbH", "", "2026-11-30",
			"billing@alice.example", web+"/pay/0xabc", web+"/api/v1/invoices/0xabc/invoice.pdf"),
		"sent-any": sent("INV-0005", "12.50 USD", "", "", "", "", "", web+"/pay/0xdef", web+"/api/v1/invoices/0xdef/invoice.pdf"),
		"reminder-before": withStop(reminder(invoice.ReminderBefore, "INV-0006", "500.00 USDC", "Base Sepolia",
			"Alice Design GmbH", "", "2026-11-30", "billing@alice.example", web+"/pay/0xabc", web+"/api/v1/invoices/0xabc/invoice.pdf")),
		"reminder-after": withStop(reminder(invoice.ReminderAfter, "INV-0007", "12.50 USD", "", "", "Mara", "2026-11-30",
			"", web+"/pay/0xdef", web+"/api/v1/invoices/0xdef/invoice.pdf")),
		"change": change("Alice Design GmbH", "Logo design", "Extra page", "150.00 USD", 7, "billing@alice.example",
			web+"/w/"+strings.Repeat("cd", 32)),
		"invite": invitation("Alice Shop", "Developer", "alice@example.com", web+"/invite/"+strings.Repeat("ef", 32)),
	}
}

func withStop(v view) view {
	v.Stop, v.Unsubscribe = web+"/reminders/"+strings.Repeat("ab", 32), web+"/api/v1/reminders/"+strings.Repeat("ab", 32)+"/stop"
	return v
}

var (
	hrefs    = regexp.MustCompile(`href="([^"]+)"`)
	textURLs = regexp.MustCompile(`https?://\S+|[\w.+-]+@[\w-]+\.[\w.]+`)
)

func links(all []string) []string {
	for i, l := range all {
		all[i] = strings.TrimPrefix(l, "mailto:")
	}
	slices.Sort(all)
	return slices.Compact(all)
}

// F200.
func TestEveryEmailHasHTMLWithTheTextLinks(t *testing.T) {
	for name, v := range samples() {
		m, err := message(site, v)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if !strings.Contains(m.HTML, "<!DOCTYPE html>") || !strings.Contains(m.HTML, ">"+v.Button.Label+"</a>") || m.Text == "" {
			t.Fatalf("%s: no designed HTML part beside the text", name)
		}
		var html []string
		for _, h := range hrefs.FindAllStringSubmatch(m.HTML, -1) {
			html = append(html, strings.ReplaceAll(h[1], "&amp;", "&"))
		}
		if got, want := links(html), links(textURLs.FindAllString(m.Text, -1)); !slices.Equal(got, want) {
			t.Fatalf("%s: HTML links %v, text links %v", name, got, want)
		}
	}
}

func TestEmailEscapesTypedNames(t *testing.T) {
	m, err := message(site, receipt("INV-0001", "5.00 USDC", "USDC", "Base Sepolia", "", `<b>Mara</b> & "Co"`, "", "pdf"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(m.HTML, "<b>Mara") || !strings.Contains(m.HTML, "&lt;b&gt;Mara&lt;/b&gt; &amp; &#34;Co&#34;") {
		t.Fatal("the typed name reached the HTML unescaped")
	}
}

// With EMAIL_SAMPLES_DIR set, writes each email's HTML there for screenshots (docs/runs); otherwise skipped.
func TestWriteEmailSamples(t *testing.T) {
	dir := os.Getenv("EMAIL_SAMPLES_DIR")
	if dir == "" {
		t.Skip("EMAIL_SAMPLES_DIR not set")
	}
	for name, v := range samples() {
		m, err := message(Site{WebURL: "https://forwend.com", PostalAddress: os.Getenv("EMAIL_POSTAL_ADDRESS")}, v)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, name+".html"), []byte(m.HTML), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}
