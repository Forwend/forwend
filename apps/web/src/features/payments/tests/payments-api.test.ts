import { afterEach, describe, expect, it, vi } from "vitest";
import { invoicesApi } from "@/features/invoices/api/invoices-api";
import { paymentsApi } from "@/features/payments/api/payments-api";
import { makeStore } from "@/store/store";

const PROFILE = "22222222-2222-2222-2222-222222222222";

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

const answer = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.restoreAllMocks());

describe("payments API", () => {
  it("reads the Payments list again after an invoice changes", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(answer({ items: [], nextCursor: null }))
      .mockResolvedValueOnce(answer({ error: { code: "invoice_not_cancelable" } }, 409))
      .mockResolvedValueOnce(answer({ items: [], nextCursor: null }));
    const store = makeStore({ getAccessToken: async () => "token-1" });
    store.dispatch(paymentsApi.endpoints.getPayments.initiate({ profileId: PROFILE }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    await store.dispatch(
      invoicesApi.endpoints.cancelInvoice.initiate({ profileId: PROFILE, invoiceId: "0x1" }),
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    const again = fetch.mock.calls[2]?.[0] as Request | undefined;
    expect(again?.url).toMatch(/\/payments\?/);
  });
});
