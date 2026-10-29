// @vitest-environment jsdom
import { ToastProvider } from "@forwend/ui-web";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityList } from "@/features/activity/components/activity-list";
import { PaymentToasts } from "@/features/activity/components/payment-toasts";
import type { ActivityItem } from "@/features/activity/types/activity";
import { invoicesApi } from "@/features/invoices/api/invoices-api";
import type { InvoiceEvent } from "@/features/invoices/types/invoices";
import { makeStore } from "@/store/store";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

const NodeRequest = globalThis.Request;
vi.stubGlobal(
  "Request",
  class extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, "http://localhost") : input, init);
    }
  },
);

const invoiceId = `0x${"a".repeat(64)}`;
const invoice: ActivityItem = {
  kind: "invoice",
  at: "2026-10-11T10:00:00Z",
  invoiceId,
  chainId: 84532,
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  symbol: "USDC",
  decimals: 6,
  amount: "1005000",
  status: "open",
  settlementStatus: "none",
  optionCount: 1,
  closed: false,
  held: false,
};
const deposit = (txHash: string, amount: string): ActivityItem => ({
  ...invoice,
  kind: "deposit",
  at: "2026-10-11T10:05:00Z",
  amount,
  status: "detected",
  settlementStatus: undefined,
  txHash,
});

let items: (ActivityItem | InvoiceEvent)[] = [];
vi.stubGlobal(
  "fetch",
  vi.fn(async () => Response.json({ items, nextCursor: null })),
);

afterEach(cleanup);

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));

describe("Activity shows invoice amounts exactly, as the invoice list, detail, pay page and PDF do", () => {
  it("renders a 1.005 USDC invoice and its 1.005 USDC payment with every digit", async () => {
    items = [deposit(`0x${"1".repeat(64)}`, "1005000"), invoice];
    const store = makeStore({ getAccessToken: async () => "token" });
    render(
      <Provider store={store}>
        <ActivityList profileId="p" />
      </Provider>,
    );
    await settle();
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("+1.005");
    expect(rows[1]).toContain("1.005");
  });

  it("toasts a 0.0015 USDC payment as 0.0015 USDC, not 0.00 USDC", async () => {
    items = [];
    const store = makeStore({ getAccessToken: async () => "token" });
    render(
      <Provider store={store}>
        <ToastProvider>
          <PaymentToasts profileId="p" />
        </ToastProvider>
      </Provider>,
    );
    await settle();
    items = [{ ...invoice, id: 1, kind: "invoice.paid", number: null, amount: "1500" }];
    await act(() =>
      store.dispatch(
        invoicesApi.endpoints.getInvoiceEvents.initiate("p", {
          forceRefetch: true,
          subscribe: false,
        }),
      ),
    );
    await settle();
    const toasts = screen.queryAllByRole("listitem").map((li) => li.textContent);
    expect(toasts).toEqual(["Payment receivedCheckout aaaaaa is paid: 0.0015 USDC."]);
  });
});

describe("Activity names held money", () => {
  it("reads a deposit the owner gets none of as held for the payer, not as a payment", async () => {
    items = [
      { ...deposit(`0x${"3".repeat(64)}`, "1000000"), held: true },
      deposit(`0x${"4".repeat(64)}`, "1000000"),
    ];
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <ActivityList profileId="p" />
      </Provider>,
    );
    await settle();
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(rows[0]).toContain("Held for the customer");
    expect(rows[0]).not.toContain("Payment");
    expect(rows[1]).toContain("Payment");
  });
});
