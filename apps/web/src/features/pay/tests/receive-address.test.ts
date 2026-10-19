import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Invoice } from "@/features/invoices/types/invoices";
import { FACTORY, IMPLEMENTATION } from "@/features/pay/constants/receive-address";
import {
  checkedReceiveAddress,
  invoiceIdOf,
  optionIdOf,
  receiveAddress,
} from "@/features/pay/lib/receive-address";

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
    new URL("../../../../../../packages/contracts/vectors/receive-address.json", import.meta.url),
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
  // The link's token; the invoice id is keccak256 of it (D-86).
  const payToken = "ab".repeat(32);
  const terms = {
    invoiceId: invoiceIdOf(payToken),
    recipient: "0x1111111111111111111111111111111111111111",
    token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
    amount: "1250000000",
    expiresAt: "2026-10-17T10:00:00Z",
    settleDeadline: "2026-10-18T10:00:00Z",
    chainId: 84532,
  };
  const invoice: Invoice = {
    ...terms,
    payToken,
    optionId: terms.invoiceId,
    optionLocked: false,
    optionCount: 1,
    confirming: false,
    closed: false,
    nextCheckAt: null,
    lines: [],
    options: [],
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
    supplyDate: null,
    reference: null,
    agreedValue: null,
    issuer: null,
    senderName: null,
    returnUrl: null,
    paymentStatus: "open",
    settlementStatus: "none",
    settlementTxHash: null,
    createdAt: "2026-10-10T10:00:00Z",
    paidAt: null,
    settledAt: null,
    canceledAt: null,
    deposits: [],
  };

  it("gives the address when the terms compute to it, in any letter case", () => {
    expect(checkedReceiveAddress(invoice, payToken)).toBe(invoice.receiveAddress);
    expect(
      checkedReceiveAddress(
        {
          ...invoice,
          receiveAddress: invoice.receiveAddress.toUpperCase().replace("0X", "0x"),
        },
        payToken,
      ),
    ).toBe(invoice.receiveAddress);
  });

  it("gives none when any term or the address changed", () => {
    const changed: Partial<Invoice>[] = [
      { invoiceId: `0x${"ac".repeat(32)}` },
      { optionId: `0x${"ac".repeat(32)}` },
      { recipient: "0x2222222222222222222222222222222222222222" },
      { token: "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d" },
      { amount: "1250000001" },
      { expiresAt: "2026-10-17T10:00:01Z" },
      { settleDeadline: "2026-10-18T10:00:01Z" },
      { chainId: 421614 },
      { receiveAddress: `0x${"2".repeat(40)}` },
    ];
    for (const change of changed) {
      expect(
        checkedReceiveAddress({ ...invoice, ...change }, payToken),
        JSON.stringify(change),
      ).toBeNull();
    }
  });

  it("gives none for a link whose token is not 32 bytes of hex, or is the invoice id itself", () => {
    for (const link of [
      "ab".repeat(31),
      `0x${"ab".repeat(32)}`,
      invoice.invoiceId,
      "zz".repeat(32),
    ]) {
      expect(checkedReceiveAddress(invoice, link), link).toBeNull();
    }
  });

  it("gives none for another invoice than the link names, even one whose terms are real", () => {
    const otherToken = "cd".repeat(32);
    const other = { ...terms, invoiceId: invoiceIdOf(otherToken) };
    const served: Invoice = {
      ...invoice,
      ...other,
      optionId: other.invoiceId,
      receiveAddress: receiveAddress({
        ...other,
        amount: 1_250_000_000n,
        expiresAt: BigInt(Date.parse(terms.expiresAt) / 1000),
        settleDeadline: BigInt(Date.parse(terms.settleDeadline) / 1000),
        intendedChainId: 84532n,
      }),
    };
    expect(checkedReceiveAddress(served, otherToken)).toBe(served.receiveAddress);
    expect(checkedReceiveAddress(served, payToken)).toBeNull();
  });

  it("derives the invoice id from the link's token as the API does (vector shared with address/option_test.go)", () => {
    expect(invoiceIdOf("7f3a9c1e5b2d4086a1c3e5f7092b4d6f8a0c2e4f6a8b0d2f4e6c8a0b2d4f6e81")).toBe(
      "0x0bc3ec4e72d7b5f3cc8a059ea1a0f06cc9d24ea5e71a2acfd86fea75540e9a31",
    );
  });

  it("derives an option's id from the invoice's as the API does (vector shared with address/option_test.go)", () => {
    expect(
      optionIdOf(
        "0x7f3a9c1e5b2d4086a1c3e5f7092b4d6f8a0c2e4f6a8b0d2f4e6c8a0b2d4f6e81",
        421614n,
        "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d",
      ),
    ).toBe("0x80166bc7ad9374378c99215bffabc884c9fe82e8876840816d1eb4e5710a89e7");
  });

  it("checks an option of a payer-chooses invoice by its own id, which must derive from the link's", () => {
    const linkToken = "ef".repeat(32);
    const link = invoiceIdOf(linkToken);
    const optionId = optionIdOf(link, BigInt(terms.chainId), terms.token);
    const option: Invoice = {
      ...invoice,
      invoiceId: link,
      optionId,
      receiveAddress: receiveAddress({
        ...terms,
        invoiceId: optionId,
        amount: 1_250_000_000n,
        expiresAt: BigInt(Date.parse(terms.expiresAt) / 1000),
        settleDeadline: BigInt(Date.parse(terms.settleDeadline) / 1000),
        intendedChainId: 84532n,
      }),
    };
    expect(checkedReceiveAddress(option, linkToken)).toBe(option.receiveAddress);
    // Another real invoice's terms under this link: their id does not derive from the link's.
    expect(checkedReceiveAddress({ ...invoice, invoiceId: link }, linkToken)).toBeNull();
  });

  it("gives none for terms the API would never create, even when they compute to the address", () => {
    const broken: Partial<Invoice>[] = [
      { amount: "0" },
      { settleDeadline: "2026-10-18T10:00:01Z" },
      { expiresAt: "2027-10-11T10:00:00Z", settleDeadline: "2027-10-12T10:00:00Z" },
      { recipient: `0x${"0".repeat(40)}` },
      { recipient: terms.token },
      { recipient: `0x${FACTORY}` },
    ];
    for (const change of broken) {
      const inv = { ...invoice, ...change };
      const consistent = {
        ...inv,
        receiveAddress: receiveAddress({
          invoiceId: inv.optionId,
          recipient: inv.recipient,
          token: inv.token,
          amount: BigInt(inv.amount),
          expiresAt: BigInt(Date.parse(inv.expiresAt) / 1000),
          settleDeadline: BigInt(Date.parse(inv.settleDeadline) / 1000),
          intendedChainId: BigInt(inv.chainId),
        }),
      };
      expect(checkedReceiveAddress(consistent, payToken), JSON.stringify(change)).toBeNull();
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
      expect(
        checkedReceiveAddress({ ...invoice, ...change }, payToken),
        JSON.stringify(change),
      ).toBeNull();
    }
  });
});
