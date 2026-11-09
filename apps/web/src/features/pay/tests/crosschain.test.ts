import { describe, expect, it } from "vitest";
import { ONECLICK_KEY } from "@/features/pay/constants/crosschain";
import {
  base58,
  fromBase58,
  type QuoteAsk,
  quoteMessage,
  verifyQuote,
} from "@/features/pay/lib/crosschain";
import answer from "@/features/pay/tests/fixtures/oneclick-quote.json";

// A quote 1Click signed on 2026-11-09 for 2.5 USDC from Arbitrum to Base (D-124). Its destination is Base USDC, its
// recipient a made-up address.
const ASK: QuoteAsk = {
  recipient: "0x5e4b7c9a1f3d2e6b8a0c4d7f9e1b3a5c7d9e0f12",
  amount: "2500000",
  originAsset: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
  refundTo: "0x6fd1c6b3f0b7a5b4e5d6a3c2b1a0f9e8d7c6b5a4",
};

const changed = (path: [string] | [string, string], value: unknown): Record<string, unknown> => {
  const copy: Record<string, unknown> = structuredClone(answer);
  const [outer, inner] = path;
  if (inner === undefined) copy[outer] = value;
  else (copy[outer] as Record<string, unknown>)[inner] = value;
  return copy;
};

describe("verifyQuote", () => {
  it("shows the address of a quote 1Click signed for exactly what the page asked", async () => {
    expect(await verifyQuote(answer, ASK, ONECLICK_KEY)).toBe(true);
    // An address in another case is the same EVM address.
    expect(
      await verifyQuote(
        answer,
        { ...ASK, recipient: ASK.recipient.toUpperCase().replace("0X", "0x") },
        ONECLICK_KEY,
      ),
    ).toBe(true);
  });

  it("refuses a quote for another payment than the page asked", async () => {
    for (const ask of [
      { ...ASK, recipient: "0x0000000000000000000000000000000000000bad" },
      { ...ASK, amount: "2400000" },
      { ...ASK, refundTo: "0x0000000000000000000000000000000000000002" },
      { ...ASK, originAsset: "nep141:eth.omft.near" },
    ]) {
      expect(await verifyQuote(answer, ask, ONECLICK_KEY)).toBe(false);
    }
  });

  it("refuses an answer changed after 1Click signed it, or signed by another key", async () => {
    for (const copy of [
      changed(["quote", "depositAddress"], "0x1Ad7e4DDd04f5680cAed3bB23271642BDA6F55Cd"),
      changed(["quote", "amountIn"], "2000000"),
      changed(["quoteRequest", "slippageTolerance"], 101),
      changed(["timestamp"], "2026-11-09T02:11:35.240Z"),
    ]) {
      expect(await verifyQuote(copy, ASK, ONECLICK_KEY)).toBe(false);
    }
    expect(await verifyQuote(answer, ASK, `ed25519:${base58(new Uint8Array(32).fill(7))}`)).toBe(
      false,
    );
    expect(await verifyQuote(null, ASK, ONECLICK_KEY)).toBe(false);
  });

  it("refuses a signed quote that needs a memo, delivers less or names another recipient chain", async () => {
    // Re-signing is impossible without 1Click's key, so these fail on the fields before the signature.
    expect(await verifyQuote(changed(["quote", "depositMemo"], "7"), ASK, ONECLICK_KEY)).toBe(
      false,
    );
    expect(
      await verifyQuote(changed(["quote", "minAmountOut"], "2499999"), ASK, ONECLICK_KEY),
    ).toBe(false);
    expect(
      await verifyQuote(
        changed(["quoteRequest", "virtualChainRecipient"], ASK.recipient),
        ASK,
        ONECLICK_KEY,
      ),
    ).toBe(false);
    expect(
      await verifyQuote(changed(["quoteRequest", "swapType"], "EXACT_INPUT"), ASK, ONECLICK_KEY),
    ).toBe(false);
  });
});

describe("base58", () => {
  it("round-trips leading zeros", () => {
    for (const bytes of [
      new Uint8Array([0, 0, 1]),
      new Uint8Array([0]),
      new Uint8Array([255, 1]),
    ]) {
      expect(fromBase58(base58(bytes))).toEqual(bytes);
    }
    expect(quoteMessage(answer)).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  });
});
