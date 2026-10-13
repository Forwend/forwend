// @vitest-environment jsdom
import { ToastProvider } from "@forwend/ui-web";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activityApi } from "@/features/activity/api/activity-api";
import { PaymentToasts } from "@/features/activity/components/payment-toasts";
import { ACTIVITY_PAGE_SIZE } from "@/features/activity/constants/activity";
import type { ActivityItem } from "@/features/activity/types/activity";
import { makeStore } from "@/store/store";

const deposit = (txHash: string): ActivityItem => ({
  kind: "deposit",
  at: "2026-10-11T10:00:00Z",
  invoiceId: "0xinv",
  chainId: 84532,
  token: "0xtoken",
  symbol: "USDC",
  decimals: 6,
  amount: "2000000",
  status: "detected",
  txHash,
  optionCount: 1,
});

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
const activity: Record<string, ActivityItem[]> = { a: [], b: [] };
vi.stubGlobal(
  "fetch",
  vi.fn(async (request: Request) => {
    const profileId = new URL(request.url).pathname.split("/")[4] ?? "";
    return Response.json({ items: activity[profileId] ?? [], nextCursor: null });
  }),
);

afterEach(cleanup);

describe("PaymentToasts", () => {
  it("toasts a new payment on the active profile, but not those that came while another profile was open", async () => {
    const store = makeStore({ getAccessToken: async () => "token" });
    const shell = (profileId: string) => (
      <Provider store={store}>
        <ToastProvider>
          <PaymentToasts profileId={profileId} />
        </ToastProvider>
      </Provider>
    );
    const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    const toasts = () => screen.queryAllByRole("listitem").map((li) => li.textContent);

    const { rerender } = render(shell("a"));
    await settle();
    activity.a = [deposit("0x1")];
    await act(() => store.dispatch(activityRefetch("a")));
    await settle();
    expect(toasts()).toEqual(["Payment detected2.00 USDC is confirming."]);

    // A payment reaches A while B is open: back on A it is not news.
    rerender(shell("b"));
    await settle();
    activity.a = [deposit("0x2"), deposit("0x1")];
    rerender(shell("a"));
    await settle();
    await act(() => store.dispatch(activityRefetch("a")));
    await settle();
    expect(toasts()).toHaveLength(1);
  });
});

function activityRefetch(profileId: string) {
  return activityApi.endpoints.getActivity.initiate(
    { profileId, limit: ACTIVITY_PAGE_SIZE },
    { forceRefetch: true, subscribe: false },
  );
}
