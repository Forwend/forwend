// @vitest-environment jsdom
import { ToastProvider } from "@forwend/ui-web";
import { cleanup, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckoutLive } from "@/features/checkout/components/checkout-live";
import type { CheckoutSession } from "@/features/checkout/types/checkout";
import { makeStore } from "@/store/store";

const NodeRequest = globalThis.Request;
vi.stubGlobal(
  "Request",
  class extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, "http://localhost") : input, init);
    }
  },
);
// The sale's first read fails, so it shows the payment the session started with.
vi.stubGlobal(
  "fetch",
  vi.fn(async () => {
    throw new TypeError("Failed to fetch");
  }),
);

const PAYMENT = {
  paymentId: `0x${"ab".repeat(32)}`,
  reference: "table-12",
  number: null,
  title: null,
  livemode: true,
  paymentStatus: "open",
  confirming: false,
  closed: false,
  closesAt: "2026-11-11T12:00:00Z",
  hostedUrl: "https://forwend.test/pay/abc",
};

afterEach(cleanup);

function renderSale(payment: Partial<typeof PAYMENT>) {
  const session = { sessionId: "s1", status: "open", payment: { ...PAYMENT, ...payment } };
  render(
    <Provider store={makeStore({ getAccessToken: async () => "token" })}>
      <ToastProvider>
        <CheckoutLive
          profileId="6f9619ff-8b86-4011-b42d-00c04fc964ff"
          session={session as unknown as CheckoutSession}
          amountUsd="12.50"
          onNewSale={vi.fn()}
        />
      </ToastProvider>
    </Provider>,
  );
}

describe("checkout sale", () => {
  it("hides the QR code and the pay link once money is on its way, so the customer can't pay twice", () => {
    for (const seen of [{ confirming: true }, { paymentStatus: "detected" }]) {
      renderSale(seen);
      expect(screen.queryByRole("img", { name: "Scan to pay" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Copy payment link" })).toBeNull();
      expect(screen.getByText("Payment seen")).toBeTruthy();
      cleanup();
    }
    // Waiting, or part paid with nothing on its way: the rest can still be paid.
    for (const open of [{}, { paymentStatus: "partially_paid" }]) {
      renderSale(open);
      expect(screen.getByRole("img", { name: "Scan to pay" })).toBeTruthy();
      cleanup();
    }
  });
});
