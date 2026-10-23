import { afterEach, describe, expect, it, vi } from "vitest";
import { balancesApi } from "@/features/balances/api/balances-api";
import { invoicesApi } from "@/features/invoices/api/invoices-api";
import { makeStore } from "@/store/store";

// The app calls the API same-origin ("/api/…"); Node's Request needs an absolute URL.
const NodeRequest = globalThis.Request;
vi.stubGlobal(
  "Request",
  class extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, "http://localhost") : input, init);
    }
  },
);

const answer = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
const store = () => makeStore({ getAccessToken: async () => null });
const TOKEN = `0x${"1".repeat(40)}`;
const BALANCE = {
  chainId: 84532,
  token: TOKEN,
  symbol: "USDC",
  decimals: 6,
  wallet: "1250000",
  finalizedBlock: 10,
  pending: "0",
  held: "0",
};

afterEach(() => vi.restoreAllMocks());

describe("API schema validation", () => {
  it("uses a response that matches its schema", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      answer({ tokens: [BALANCE], estimatedUsdTotal: "1.25" }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await store().dispatch(balancesApi.endpoints.getBalances.initiate("p"));
    expect(result.data?.tokens[0]?.wallet).toBe("1250000");
  });

  it("reports a malformed response as a failed request and never hands its money on", async () => {
    // A float where base units belong: drawing it would show the wrong amount.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      answer({ tokens: [{ ...BALANCE, wallet: "1.25" }], estimatedUsdTotal: "1.25" }),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await store().dispatch(balancesApi.endpoints.getBalances.initiate("p"));
    expect(result.data).toBeUndefined();
    expect(result.error).toEqual({
      status: "CUSTOM_ERROR",
      error: "responseSchema failed validation",
    });
    expect(log).toHaveBeenCalledWith("getBalances: responseSchema failed at tokens.0.wallet");
    expect(String(log.mock.calls)).not.toContain("1.25");
  });

  it("refuses to send a request body that breaks its schema", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await store().dispatch(
      invoicesApi.endpoints.createInvoice.initiate({
        profileId: "11111111-1111-1111-1111-111111111111",
        idempotencyKey: "k-1",
        // biome-ignore lint/suspicious/noExplicitAny: the test sends what the types would refuse
        body: { amount: "12.50" } as any,
      }),
    );
    expect(result.error).toEqual({ status: "CUSTOM_ERROR", error: "argSchema failed validation" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
