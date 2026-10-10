import { describe, expect, it } from "vitest";
import { breadcrumb } from "@/screens/app-shell/app-nav";

const ID = `0x${"a".repeat(64)}`;

describe("breadcrumb", () => {
  it("links each page, and a form under its page", () => {
    expect(breadcrumb("/app")).toEqual({
      trail: [{ label: "Overview", href: "/app" }],
      invoiceId: null,
    });
    expect(breadcrumb("/app/transactions").trail).toEqual([
      { label: "Transactions", href: "/app/transactions" },
    ]);
    expect(breadcrumb("/app/invoices/new")).toEqual({
      trail: [
        { label: "Invoices", href: "/app/invoices" },
        { label: "New invoice", href: "/app/invoices/new" },
      ],
      invoiceId: null,
    });
    expect(breadcrumb("/app/profiles/new").trail).toEqual([
      { label: "New profile", href: "/app/profiles/new" },
    ]);
  });

  it("gives an invoice page's id for the header to name by its number", () => {
    expect(breadcrumb(`/app/invoices/${ID}`)).toEqual({
      trail: [{ label: "Invoices", href: "/app/invoices" }],
      invoiceId: ID,
    });
    expect(breadcrumb("/app/invoices").invoiceId).toBeNull();
  });
});
