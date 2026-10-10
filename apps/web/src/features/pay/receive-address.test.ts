import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Invoice } from "@/features/invoices/invoices";
import {
  checkedReceiveAddress,
  FACTORY,
  IMPLEMENTATION,
  receiveAddress,
} from "@/features/pay/receive-address";

// Written by Foundry from factory.predict (R-15); see packages/contracts/script/ReceiveAddressVectors.s.sol.
const vectors: {
  factory: string;
  implementation: string;
  vectors: Record<
    | "invoiceId"
    | "recipient"
    | "token"
    | "amount"
    | "expiresAt"
    | "settleDeadline"
    | "intendedChainId"
    | "receiver",
    string
  >[];
} = JSON.parse(
  readFileSync(
    new URL("../../../../../packages/contracts/vectors/receive-address.json", import.meta.url),
    "utf8",
  ),
);

describe("receiveAddress", () => {
  it("builds in the factory and implementation the vectors were made with", () => {
    expect(`0x${FACTORY}`).toBe(vectors.factory.toLowerCase());
    expect(`0x${IMPLEMENTATION}`).toBe(vectors.implementation.toLowerCase());
  });

  it("matches factory.predict for every R-15 vector", () => {
    expect(vectors.vectors.length).toBeGreaterThanOrEqual(20);
    for (const v of vectors.vectors) {
      expect(
        receiveAddress({
          invoiceId: v.invoiceId,
          recipient: v.recipient,
          token: v.token,
          amount: BigInt(v.amount),
          expiresAt: BigInt(v.expiresAt),
          settleDeadline: BigInt(v.settleDeadline),
          intendedChainId: BigInt(v.intendedChainId),
        }),
      ).toBe(v.receiver.toLowerCase());
    }
  });
});

describe("checkedReceiveAddress", () => {
  const terms = {
    invoiceId: `0x${"ab".repeat(32)}`,
    recipient: "0x1111111111111111111111111111111111111111",
    token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
    amount: "1250000000",
    expiresAt: "2026-10-17T10:00:00Z",
    settleDeadline: "2026-10-18T10:00:00Z",
    chainId: 84532,
  };
  const invoice: Invoice = {
    ...terms,
    receiveAddress: receiveAddress({
      ...terms,
      amount: 1_250_000_000n,
      expiresAt: BigInt(Date.parse(terms.expiresAt) / 1000),
      settleDeadline: BigInt(Date.parse(terms.settleDeadline) / 1000),
      intendedChainId: 84532n,
    }),
    number: 1,
    title: null,
    note: null,
    dueDate: null,
    issuer: null,
    senderName: null,
    paymentStatus: "open",
    settlementStatus: "none",
    settlementTxHash: null,
    createdAt: "2026-10-10T10:00:00Z",
    paidAt: null,
    settledAt: null,
    deposits: [],
  };

  it("gives the address when the terms compute to it, in any letter case", () => {
    expect(checkedReceiveAddress(invoice)).toBe(invoice.receiveAddress);
    expect(
      checkedReceiveAddress({
        ...invoice,
        receiveAddress: invoice.receiveAddress.toUpperCase().replace("0X", "0x"),
      }),
    ).toBe(invoice.receiveAddress);
  });

  it("gives none when any term or the address changed", () => {
    const changed: Partial<Invoice>[] = [
      { invoiceId: `0x${"ac".repeat(32)}` },
      { recipient: "0x2222222222222222222222222222222222222222" },
      { token: "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d" },
      { amount: "1250000001" },
      { expiresAt: "2026-10-17T10:00:01Z" },
      { settleDeadline: "2026-10-18T10:00:01Z" },
      { chainId: 421614 },
      { receiveAddress: `0x${"2".repeat(40)}` },
    ];
    for (const change of changed) {
      expect(checkedReceiveAddress({ ...invoice, ...change }), JSON.stringify(change)).toBeNull();
    }
  });

  it("gives none when a term can't be read", () => {
    for (const change of [
      { amount: "-1" },
      { amount: (2n ** 256n).toString() },
      { recipient: "0x1111" },
      { expiresAt: "soon" },
      { expiresAt: "2026-10-17T10:00:00.500Z" },
    ]) {
      expect(checkedReceiveAddress({ ...invoice, ...change }), JSON.stringify(change)).toBeNull();
    }
  });
});
