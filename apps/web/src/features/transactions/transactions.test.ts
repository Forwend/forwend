import { PAYMENT_STATUS } from "@forwend/ui-web";
import { describe, expect, it } from "vitest";
import {
  filterTransactions,
  type Transaction,
  transactionStatus,
  transactionsCsv,
} from "@/features/transactions/transactions";

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
  it("shows a transfer as confirming until its block is final, also for unknown statuses", () => {
    expect(transactionStatus(base)).toBe(PAYMENT_STATUS.confirmed);
    expect(transactionStatus({ ...base, status: "detected" })).toBe(PAYMENT_STATUS.confirming);
    expect(transactionStatus({ ...base, status: "new_value" })).toBe(PAYMENT_STATUS.confirming);
  });

  it("filters by direction and by counterparty, hash or token in any letter case", () => {
    const out: Transaction = { ...base, direction: "out", counterparty: `0x${"2".repeat(40)}` };
    expect(filterTransactions([base, out], "in", "")).toEqual([base]);
    expect(filterTransactions([base, out], "all", "abcd")).toEqual([base]);
    expect(filterTransactions([base, out], "all", " USDC ")).toEqual([base, out]);
    expect(filterTransactions([base, out], "out", "abcd")).toEqual([]);
  });

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
