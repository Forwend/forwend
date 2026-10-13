// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InvoiceAmount } from "@/features/invoices/components/invoice-amount";
import type { InvoiceSummary } from "@/features/invoices/invoices";

const USDC = {
  chainId: 84532,
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  symbol: "USDC",
  decimals: 6,
};
const invoice = (optionCount: number, optionLocked: boolean) =>
  ({
    chainId: USDC.chainId,
    token: USDC.token,
    amount: "12500000",
    optionCount,
    optionLocked,
  }) as InvoiceSummary;

afterEach(cleanup);

describe("InvoiceAmount", () => {
  it("shows USD for an invoice that accepts several options, chosen or not, else the token", () => {
    const text = (inv: InvoiceSummary) =>
      render(<InvoiceAmount invoice={inv} tokens={[USDC]} />).container.textContent;
    expect(text(invoice(4, false))).toMatch(/12\.50\s*USD$/);
    cleanup();
    expect(text(invoice(4, true))).toMatch(/12\.50\s*USD$/);
    cleanup();
    expect(text(invoice(1, false))).toMatch(/12\.50\s*USDC$/);
  });
});
