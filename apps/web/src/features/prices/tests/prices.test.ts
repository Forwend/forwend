import { describe, expect, it } from "vitest";
import { findPrice, latestUsd, totalUsdCents, usdCents } from "@/features/prices/lib/prices";
import { pricesSchema } from "@/features/prices/schemas/prices";
import type { TokenPrice } from "@/features/prices/types/prices";

const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const OUSD = "0x20c0000000000000000000006a37da5c996874be";
const EURC = "0x1111111111111111111111111111111111111111";
const READ = "2026-10-28T10:15:00Z";

function price(token: string, chainId: number, usd: string | null): TokenPrice {
  return {
    chainId,
    token,
    symbol: "USDC",
    coinId: "usd-coin",
    usd,
    sourceUpdatedAt: usd ? READ : null,
    fetchedAt: usd ? READ : null,
    stale: usd === null,
  };
}

const USDC_PRICE = price(USDC, 84532, "0.999542");
const PRICES = [
  USDC_PRICE,
  price(OUSD, 42431, "1.000001"),
  { ...price(EURC, 84532, null), coinId: null },
];

describe("prices (R-178)", () => {
  it("finds a token by chain and contract in any letter case", () => {
    expect(findPrice(PRICES, 84532, USDC.toUpperCase().replace("0X", "0x"))?.usd).toBe("0.999542");
    expect(findPrice(PRICES, 421614, USDC)).toBeUndefined();
  });

  it("values exact base units without floating point", () => {
    // A float gives 100000099999999983616 here.
    expect(usdCents(999_999_999_999_999_999_999_999n, 6, "1.000001")).toBe(
      100_000_099_999_999_999_999n,
    );
    expect(usdCents(123_456_789_012_345_678_901_234_567_890n, 18, "0.999542")).toBe(
      12_340_024_580_297n,
    );
    expect(usdCents(10n ** 77n, 77, "0.999999999999999999")).toBe(99n);
    expect(usdCents(1n, 6, "0.999542")).toBe(0n);
  });

  it("adds amounts before cutting to cents once", () => {
    const half = { chainId: 84532, token: USDC, baseUnits: 5_000n, decimals: 6 };
    expect(usdCents(half.baseUnits, half.decimals, "1.000001")).toBe(0n);
    const prices = [price(USDC, 84532, "1.000001"), price(OUSD, 42431, "1.000001")];
    expect(totalUsdCents(prices, [half, { ...half, chainId: 42431, token: OUSD }])).toBe(1n);
    expect(totalUsdCents(PRICES, [])).toBe(0n);
  });

  it("gives no value without a price, never 1 USD, and values at an old price", () => {
    const usdc = { chainId: 84532, token: USDC, baseUnits: 1_000_000n, decimals: 6 };
    const eurc = { chainId: 84532, token: EURC, baseUnits: 1_000_000n, decimals: 6 };
    expect(totalUsdCents(PRICES, [usdc])).toBe(99n);
    expect(totalUsdCents(PRICES, [usdc, eurc])).toBeNull();
    expect(totalUsdCents(PRICES, [usdc, { ...eurc, baseUnits: 0n }])).toBe(99n);
    expect(totalUsdCents([], [usdc])).toBeNull();
    expect(totalUsdCents([{ ...USDC_PRICE, stale: true }], [usdc])).toBe(99n);
    expect(latestUsd(undefined)).toBeNull();
  });

  it("refuses a price sent as a float", () => {
    const answer = { prices: [USDC_PRICE] };
    expect(pricesSchema.safeParse(answer).success).toBe(true);
    expect(pricesSchema.safeParse({ prices: [{ ...USDC_PRICE, usd: 0.999542 }] }).success).toBe(
      false,
    );
  });
});
