import { describe, expect, it } from "vitest";
import type { Send } from "@/features/send/types/send";
import { TRANSACTION_STATUSES } from "@/features/transactions/constants/transactions";
import { sendingRows } from "@/features/transactions/lib/transactions";
import type { Transaction } from "@/features/transactions/types/transactions";

const send = (txHash: string | null) =>
  ({
    sendId: txHash ?? "unsigned",
    chainId: 84532,
    token: "0xaa",
    symbol: "USDC",
    decimals: 6,
    amount: "100",
    to: "0xbb",
    toProfileId: null,
    txHash,
    createdAt: "2026-11-06T10:00:00Z",
  }) as Send;

describe("sending rows (R-215)", () => {
  it("shows each signed send until a recorded row carries its hash", () => {
    const recorded = [{ txHash: "0x2" }] as Transaction[];
    const rows = sendingRows([send(null), send("0x1"), send("0x2")], recorded);
    expect(rows.map((r) => [r.txHash, r.status])).toEqual([["0x1", TRANSACTION_STATUSES.sending]]);
  });
});
