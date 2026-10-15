import { PAYMENT_STATUS } from "@forwend/ui-web";
import { describe, expect, it } from "vitest";
import {
  groupByDay,
  transactionStatus,
  transactionsCsv,
} from "@/features/transactions/lib/transactions";
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
  it("shows a transfer as confirming until its block is final, also for unknown statuses", () => {
    expect(transactionStatus(base)).toBe(PAYMENT_STATUS.confirmed);
    expect(transactionStatus({ ...base, status: "detected" })).toBe(PAYMENT_STATUS.confirming);
    expect(transactionStatus({ ...base, status: "new_value" })).toBe(PAYMENT_STATUS.confirming);
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

describe("groupByDay", () => {
  it("cuts the list into runs of one local day, named today, yesterday or by their date", () => {
    const now = new Date(2026, 9, 10, 12, 0);
    const at = (d: number, h: number) => ({ at: new Date(2026, 9, d, h).toISOString() });
    const groups = groupByDay([at(10, 10), at(10, 1), at(9, 16), at(8, 22), at(8, 4)], now);
    expect(groups.map((g) => g.items.length)).toEqual([2, 1, 2]);
    expect(groups[0]?.when).toBe("today");
    expect(groups[1]?.when).toBe("yesterday");
    expect(groups[2]?.day).toBe("2026-10-08");
    expect(groups[2]?.when).toBeInstanceOf(Date);
  });

  it("keeps the given order, so a day that comes back starts a new run", () => {
    const now = new Date(2026, 9, 10, 12, 0);
    const at = (d: number) => ({ at: new Date(2026, 9, d, 9).toISOString() });
    expect(groupByDay([at(8), at(7), at(8)], now).map((g) => g.day)).toEqual([
      "2026-10-08",
      "2026-10-07",
      "2026-10-08",
    ]);
  });
});
