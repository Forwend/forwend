// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePricedBalances } from "@/features/balances/hooks/use-priced-balances";
import { makeStore } from "@/store/store";

// The app calls the API same-origin ("/api/…"); the test's Request needs an absolute URL.
const NodeRequest = globalThis.Request;
vi.stubGlobal(
  "Request",
  class extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, "http://localhost") : input, init);
    }
  },
);

const TOKEN = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const BALANCES = {
  tokens: [
    {
      chainId: 84532,
      token: TOKEN,
      symbol: "USDC",
      decimals: 6,
      wallet: "2500000",
      finalizedBlock: 10,
      pending: "0",
      held: "0",
    },
  ],
  estimatedUsdTotal: "2.50",
};
const PRICES = {
  prices: [
    {
      chainId: 84532,
      token: TOKEN,
      symbol: "USDC",
      coinId: "usd-coin",
      usd: "1",
      sourceUpdatedAt: "2026-10-30T00:00:00Z",
      fetchedAt: "2026-10-30T00:00:00Z",
      stale: false,
    },
  ],
};
const answer = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("usePricedBalances", () => {
  it("keeps the balances back until the prices answer, so a total never flashes 'no prices'", async () => {
    let pricesAnswer: (response: Response) => void = () => {};
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      (input as Request).url.endsWith("/v1/prices")
        ? new Promise<Response>((resolve) => {
            pricesAnswer = resolve;
          })
        : answer(BALANCES),
    );
    const store = makeStore({ getAccessToken: async () => null });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const { result } = renderHook(() => usePricedBalances("p"), { wrapper });

    // The balances have answered; the prices have not.
    await waitFor(() =>
      expect(store.getState().api.queries['getBalances("p")']?.status).toBe("fulfilled"),
    );
    expect(result.current.balances).toBeNull();

    await act(async () => pricesAnswer(answer(PRICES)));
    await waitFor(() => expect(result.current.balances?.tokens[0]?.wallet).toBe("2500000"));
    expect(result.current.prices?.[0]?.usd).toBe("1");
  });
});
