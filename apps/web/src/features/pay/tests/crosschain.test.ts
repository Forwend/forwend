import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ONECLICK_KEY } from "@/features/pay/constants/crosschain";
import {
  base58,
  crossChainFeeUsd,
  crossChainKey,
  fromBase58,
  type QuoteAsk,
  quoteMessage,
  sendUnits,
  signedDeposit,
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

// A key of the test's own, to sign answers 1Click never would.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const TEST_KEY = `ed25519:${base58(new Uint8Array(publicKey.export({ format: "der", type: "spki" }).subarray(-32)))}`;
const resigned = (copy: Record<string, unknown>) => ({
  ...copy,
  signature: `ed25519:${base58(new Uint8Array(sign(null, Buffer.from(quoteMessage(copy)), privateKey)))}`,
});

describe("verifyQuote on answers a key signed", () => {
  it("refuses more slippage than the api asks for, which would go back to the refund address", async () => {
    expect(await verifyQuote(resigned(structuredClone(answer)), ASK, TEST_KEY)).toBe(true);
    const more: Record<string, unknown> = structuredClone(answer);
    (more.quoteRequest as Record<string, unknown>).slippageTolerance = 500;
    expect(await verifyQuote(resigned(more), ASK, TEST_KEY)).toBe(false);
  });
});

describe("crossChainKey", () => {
  it("takes a test build's key only on loopback", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"])
      expect(crossChainKey(host, TEST_KEY)).toBe(TEST_KEY);
    for (const host of ["pay.forwend.com", "127.0.0.1.example.com", ""]) {
      expect(crossChainKey(host, TEST_KEY)).toBe(ONECLICK_KEY);
    }
    expect(crossChainKey("localhost", "")).toBe(ONECLICK_KEY);
  });
});

// R-244: what a payer is asked to send reads like money, and never less than 1Click asked for.
describe("sendUnits", () => {
  it("rounds a stablecoin up to the cent", () => {
    expect(sendUnits(15_154_472_423n, 6, 0.9995)).toBe(15_154_480_000n);
    expect(sendUnits(2_500_000n, 6, 1)).toBe(2_500_000n);
    // 18 decimals, as USD1 on Ethereum has.
    expect(sendUnits(15_000_060_000_000_000_000_001n, 18, 0.998)).toBe(
      15_000_070_000_000_000_000_000n,
    );
  });

  it("counts 0.98 and 1.02 USD as stablecoins, as the api orders them", () => {
    expect(sendUnits(1_000_001n, 6, 0.98)).toBe(1_010_000n);
    expect(sendUnits(1_000_001n, 6, 1.02)).toBe(1_010_000n);
    expect(sendUnits(1_000_001n, 6, 1.03)).toBe(1_000_100n);
  });

  it("rounds any other token up to 5 significant digits", () => {
    expect(sendUnits(20_310_888n, 8, 74_760)).toBe(20_311_000n); // 0.20310888 cbBTC is 0.20311
    expect(sendUnits(22_124_908_065_441_173_327n, 18, 687.35)).toBe(22_125_000_000_000_000_000n); // 22.125 BNB
    expect(sendUnits(4_285_100_000_000_000_000n, 18, 3_500)).toBe(4_285_100_000_000_000_000n); // already 5 digits
    expect(sendUnits(999n, 0, 0.2)).toBe(999n);
  });
});

describe("signedDeposit", () => {
  it("asks for the signed amount rounded up at the price 1Click signed", () => {
    // 2.527977 USDC at 2.526427350099 USD: a stablecoin, so 2.53 USDC.
    expect(signedDeposit(answer, 6)).toEqual({
      depositAddress: answer.quote.depositAddress,
      amountIn: 2_527_977n,
      send: 2_530_000n,
    });
  });
});

describe("crossChainFeeUsd", () => {
  it("is the least 1Click converts, at its price, over what arrives: the slippage comes back", () => {
    // 2.502697 USDC at 0.999387 USD each is 2.501163 USD; 2.5 USDC arrive, worth 2.498468 USD.
    expect(crossChainFeeUsd(answer.quote)).toBeCloseTo(0.002695, 6);
    expect(crossChainFeeUsd({ ...answer.quote, amountOutUsd: "3" })).toBe(0);
  });
});
