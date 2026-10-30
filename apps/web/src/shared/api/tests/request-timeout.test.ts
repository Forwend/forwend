import { afterEach, describe, expect, it, vi } from "vitest";
import { balancesApi } from "@/features/balances/api/balances-api";
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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a request with no answer", () => {
  it("fails after 30 seconds, so the page offers Try again instead of loading forever", async () => {
    vi.useFakeTimers();
    // A server that never answers. As in a browser, an aborted fetch rejects with its signal's reason.
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (input) =>
        new Promise((_, reject) => {
          const { signal } = input as Request;
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    const store = makeStore({ getAccessToken: async () => null });
    const read = store.dispatch(balancesApi.endpoints.getBalances.initiate("p"));
    await vi.advanceTimersByTimeAsync(29_000);
    expect(balancesApi.endpoints.getBalances.select("p")(store.getState()).isLoading).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await read).error).toMatchObject({ status: "TIMEOUT_ERROR" });
  });
});
