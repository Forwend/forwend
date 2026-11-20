package notify

import (
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/outbox"
	"github.com/forwend/forwend/apps/backend/internal/webhook"
)

func samples() map[string]view {
	tx := "https://sepolia.basescan.org/tx/0x" + strings.Repeat("cd", 32)
	link, settings := web+"/app/invoices/0xabc", web+"/app/notifications"
	return map[string]view{
		"paid":          compose(outbox.Paid, "INV-0001", "1,250.00 USDC", "Base Sepolia", link, settings),
		"settled":       compose(outbox.Settled, "INV-0001", "1,250.00 USDC", "Base Sepolia", link, settings),
		"held":          compose(outbox.Held, "INV-0002", "1.00 USDC", "Base Sepolia", link, settings),
		"receipt":       receipt("INV-0001", "1,250.00 USDC", "Base Sepolia", "Alice Design GmbH", "", tx, web+"/api/v1/invoices/0xabc/receipt.pdf"),
		"receipt-typed": receipt("INV-0003", "40.00 USDC", "Base Sepolia", "", "MaraIlicDesignStudioInvoicesForInternationalClientsLimited", "", web+"/api/v1/invoices/0xdef/receipt.pdf"),
		"welcome":       welcome(web + "/app"),
		"code":          confirm(web+"/app", "042517", 10*time.Minute),
		"sent": marked(sent("INV-0004", "1,250.00 USDC", "Base Sepolia", "Alice Design GmbH", "", "30 Nov 2026",
			"billing@alice.example", web+"/pay/0xabc", web+"/api/v1/invoices/0xabc/invoice.pdf"), false),
		"sent-any": sent("INV-0005", "12.50 USD", "", "", "", "", "", web+"/pay/0xdef", web+"/api/v1/invoices/0xdef/invoice.pdf"),
		"reminder-before": withStop(reminder(invoice.ReminderBefore, "INV-0006", "500.00 USDC", "Base Sepolia",
			"Alice Design GmbH", "", "30 Nov 2026", "billing@alice.example", web+"/pay/0xabc", web+"/api/v1/invoices/0xabc/invoice.pdf")),
		"reminder-due": withStop(reminder(invoice.ReminderDue, "INV-0006", "500.00 USDC", "Base Sepolia",
			"Alice Design GmbH", "", "30 Nov 2026", "billing@alice.example", web+"/pay/0xabc", web+"/api/v1/invoices/0xabc/invoice.pdf")),
		"reminder-after": withStop(reminder(invoice.ReminderAfter, "INV-0007", "12.50 USD", "", "", "Mara", "30 Nov 2026",
			"", web+"/pay/0xdef", web+"/api/v1/invoices/0xdef/invoice.pdf")),
		"change": change("Alice Design GmbH", "Logo design", "Extra page", "150.00 USD", 7, "billing@alice.example",
			web+"/w/"+strings.Repeat("cd", 32)),
		"invite":          invitation("Alice Shop", "Developer", "alice@example.com", web+"/invite/"+strings.Repeat("ef", 32)),
		"outflow":         outflow("250.00 USDC", "0x"+strings.Repeat("4a", 20), "Base Sepolia", tx, web+"/app/settings"),
		"waiting":         waiting(web + "/app/transactions"),
		"webhook-failing": disabled("shop.example.com", webhook.Failing, web+"/app/developers"),
		"webhook-gone":    disabled("shop.example.com", webhook.Gone, web+"/app/developers"),
		"retainer-failed": retainerFailed("INV-0008", "Bob Ltd", "28 Feb 2027", link),
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
	m, err := message(site, receipt("INV-0001", "5.00 USDC", "Base Sepolia", "", `<b>Mara</b> & "Co"`, "", "pdf"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(m.HTML, "<b>Mara") || !strings.Contains(m.HTML, "&lt;b&gt;Mara&lt;/b&gt; &amp; &#34;Co&#34;") {
		t.Fatal("the typed name reached the HTML unescaped")
	}
}

func TestTheLogoIsInTheWebApp(t *testing.T) {
	if _, err := os.Stat(webPublic + logo); err != nil {
		t.Fatal(err)
	}
}

const webPublic = "../../../web/public"
