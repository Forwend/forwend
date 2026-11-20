import { afterEach, expect, it, vi } from "vitest";
import { balancesApi } from "@/features/balances/api/balances-api";
import { makeStore } from "@/store/store";

const BALANCE = {
  chainId: 84532,
  token: `0x${"1".repeat(40)}`,
  symbol: "USDC",
  decimals: 6,
  wallet: "1250000",
  finalizedBlock: 10,
  pending: "0",
  held: "0",
};

afterEach(() => vi.restoreAllMocks());

it("never hands on a balance that is not whole base units", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(
      JSON.stringify({ tokens: [{ ...BALANCE, wallet: "1.25" }], estimatedUsdTotal: "1.25" }),
      { headers: { "Content-Type": "application/json" } },
    ),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
  const store = makeStore({ getAccessToken: async () => null });
  const result = await store.dispatch(balancesApi.endpoints.getBalances.initiate("p"));
  expect(result.data).toBeUndefined();
  expect(result.error).toEqual({
    status: "CUSTOM_ERROR",
    error: "responseSchema failed validation",
  });
});
