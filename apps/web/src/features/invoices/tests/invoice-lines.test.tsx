// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InvoiceLines } from "@/features/invoices/components/invoice-lines";
import { linesFigures } from "@/features/invoices/lib/invoices";

afterEach(cleanup);

const LINES = [
  { description: "Window", quantity: "1.00", unitPrice: "45000000", amount: "45000000" },
];
const option = (amount: string, feesPaidBy: "owner" | "client") => ({
  amount,
  networkFee: "60000",
  platformFee: "0",
  feesPaidBy,
  decimals: 6,
});
const row = (term: string) => screen.getByText(term).nextElementSibling?.textContent;

// R-228, D-122: every option carries the same fee, so the owner's Items show it before the client picks a network.
describe("InvoiceLines fees", () => {
  it("takes the fee from what the owner receives when the owner pays", () => {
    const main = option("45000000", "owner");
    render(
      <InvoiceLines lines={LINES} decimals={6} unit="USD" {...linesFigures(main, main)} owner />,
    );
    expect(row("Total")).toBe("45.00 USD");
    expect(row("Network fee")).toBe("−0.06 USD");
    expect(row("You receive")).toBe("44.94 USD");
  });

  it("adds the client's fee above the total, and the owner receives the price", () => {
    const main = option("45060000", "client");
    render(
      <InvoiceLines lines={LINES} decimals={6} unit="USD" {...linesFigures(main, main)} owner />,
    );
    expect(row("Subtotal")).toBe("45.00 USD");
    expect(row("Network fee")).toBe("0.06 USD");
    expect(row("Total")).toBe("45.06 USD");
    expect(row("You receive")).toBe("45.00 USD");
  });
});
