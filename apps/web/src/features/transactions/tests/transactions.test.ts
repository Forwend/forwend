import { describe, expect, it } from "vitest";
import { transactionsCsv } from "@/features/transactions/lib/transactions";
import type { Transaction } from "@/features/transactions/types/transactions";

const base: Transaction = {
  chainId: 84532,
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  symbol: "USDC",
  decimals: 6,
  direction: "in",
  amount: "1234567891",
  counterparty: "0xAbCd000000000000000000000000000000000001",
  txHash: `0x${"a".repeat(64)}`,
  logIndex: 0,
  blockNumber: 10,
  at: "2026-10-10T08:00:00Z",
  status: "confirmed",
};

describe("transactions", () => {
  it("exports exact amounts without separators, and never a cell a spreadsheet would run", () => {
    const [header, row] = transactionsCsv([{ ...base, symbol: '=HYPERLINK("x")' }]).split("\r\n");
    expect(header).toBe(
      '"Date (UTC)","Direction","Amount","Token","Network","Counterparty","Transaction","Status"',
    );
    expect(row).toContain('"1234.567891"');
    expect(row).toContain('"\'=HYPERLINK(""x"")"');
    expect(row).toContain('"Base Sepolia"');
    expect(transactionsCsv([{ ...base, symbol: "\t=1+1" }])).toContain('"\'\t=1+1"');
  });
});
