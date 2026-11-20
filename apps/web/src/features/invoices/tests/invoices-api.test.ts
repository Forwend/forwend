import { afterEach, expect, it, vi } from "vitest";
import { invoicesApi } from "@/features/invoices/api/invoices-api";
import { makeStore } from "@/store/store";

afterEach(() => vi.restoreAllMocks());

it("never sends an invoice whose amount is not whole base units", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  vi.spyOn(console, "error").mockImplementation(() => {});
  const store = makeStore({ getAccessToken: async () => null });
  const result = await store.dispatch(
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
