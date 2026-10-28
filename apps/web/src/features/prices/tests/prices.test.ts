import { describe, expect, it } from "vitest";
import {
  findPrice,
  freshUsd,
  pricesStatus,
  totalUsdCents,
  usdCents,
} from "@/features/prices/lib/prices";
import { pricesSchema } from "@/features/prices/schemas/prices";
import type { TokenPrice } from "@/features/prices/types/prices";

const NOW = Date.parse("2026-10-28T10:30:00Z");
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
    expect(totalUsdCents(prices, [half, { ...half, chainId: 42431, token: OUSD }], NOW)).toBe(1n);
    expect(totalUsdCents(PRICES, [], NOW)).toBe(0n);
  });

  it("gives no value without a fresh price, never 1 USD", () => {
    const usdc = { chainId: 84532, token: USDC, baseUnits: 1_000_000n, decimals: 6 };
    const eurc = { chainId: 84532, token: EURC, baseUnits: 1_000_000n, decimals: 6 };
    expect(totalUsdCents(PRICES, [usdc], NOW)).toBe(99n);
    expect(totalUsdCents(PRICES, [usdc, eurc], NOW)).toBeNull();
    expect(totalUsdCents(PRICES, [usdc, { ...eurc, baseUnits: 0n }], NOW)).toBe(99n);
    expect(totalUsdCents([], [usdc], NOW)).toBeNull();
    expect(totalUsdCents([{ ...USDC_PRICE, stale: true }], [usdc], NOW)).toBeNull();
    // The cached answer ages: an hour after the read, or a day after CoinGecko's update, it is stale.
    expect(freshUsd(USDC_PRICE, Date.parse("2026-10-28T11:15:00Z"))).toBe("0.999542");
    expect(freshUsd(USDC_PRICE, Date.parse("2026-10-28T11:15:01Z"))).toBeNull();
    const oldSource = { ...USDC_PRICE, sourceUpdatedAt: "2026-10-27T10:29:59Z" };
    expect(freshUsd(oldSource, NOW)).toBeNull();
  });

  it("reports the latest read and whether a coin's price is stale", () => {
    expect(pricesStatus(PRICES, NOW)).toEqual({ updatedAt: "2026-10-28T10:15:00Z", stale: false });
    expect(pricesStatus([...PRICES, price(USDC, 421614, null)], NOW).stale).toBe(true);
    expect(pricesStatus([], NOW)).toEqual({ updatedAt: null, stale: false });
  });

  it("refuses a price sent as a float", () => {
    const answer = { prices: [USDC_PRICE] };
    expect(pricesSchema.safeParse(answer).success).toBe(true);
    expect(pricesSchema.safeParse({ prices: [{ ...USDC_PRICE, usd: 0.999542 }] }).success).toBe(
      false,
    );
  });
});
