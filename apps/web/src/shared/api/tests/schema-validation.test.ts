import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { apiSlice } from "@/shared/api/api-slice";
import { baseUnits } from "@/shared/schemas/api";
import { makeStore } from "@/store/store";

const testApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    readBalance: build.query<{ wallet: string }, void>({
      query: () => "/test/balance",
      responseSchema: z.object({ wallet: baseUnits }),
    }),
    sendAmount: build.mutation<void, { amount: string }>({
      query: (body) => ({ url: "/test/amount", method: "POST", body }),
      argSchema: z.object({ amount: baseUnits }),
    }),
  }),
});

const answer = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
const store = () => makeStore({ getAccessToken: async () => null });

afterEach(() => vi.restoreAllMocks());

describe("API schema validation", () => {
  it("uses a response that matches its schema", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(answer({ wallet: "1250000" }));
    const result = await store().dispatch(testApi.endpoints.readBalance.initiate());
    expect(result.data?.wallet).toBe("1250000");
  });

  it("reports a malformed response as a failed request and never hands its money on", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(answer({ wallet: "1.25" }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await store().dispatch(testApi.endpoints.readBalance.initiate());
    expect(result.data).toBeUndefined();
    expect(result.error).toEqual({
      status: "CUSTOM_ERROR",
      error: "responseSchema failed validation",
    });
    expect(log).toHaveBeenCalledWith("readBalance: responseSchema failed at wallet");
    expect(String(log.mock.calls)).not.toContain("1.25");
  });

  it("refuses to send a request body that breaks its schema", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await store().dispatch(
      testApi.endpoints.sendAmount.initiate({ amount: "12.50" }),
    );
    expect(result.error).toEqual({ status: "CUSTOM_ERROR", error: "argSchema failed validation" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
