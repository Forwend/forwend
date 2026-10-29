// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckoutForm } from "@/features/checkout/components/checkout-form";
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

const PROFILE = "6f9619ff-8b86-4011-b42d-00c04fc964ff";
const STORE = {
  storeId: "66666666-6666-4666-8666-666666666666",
  name: "Counter",
  defaultExpiresIn: 3600,
  allowedOrigins: [],
  brandColor: null,
  logoAt: null,
  tokensOff: [],
  updatedAt: "2026-09-02T00:00:00Z",
};

afterEach(cleanup);

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));

function renderForm() {
  const requests: { key: string | null; body: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      requests.push({ key: request.headers.get("Idempotency-Key"), body: await request.text() });
      throw new TypeError("Failed to fetch");
    }),
  );
  render(
    <Provider store={makeStore({ getAccessToken: async () => "token" })}>
      <CheckoutForm profileId={PROFILE} stores={[STORE]} onStarted={vi.fn()} />
    </Provider>,
  );
  return requests;
}

describe("checkout form", () => {
  it("sends nothing without a valid amount", async () => {
    const requests = renderForm();
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "12.505" } });
    fireEvent.click(screen.getByRole("button", { name: "Show QR code" }));
    await settle();
    expect(requests).toHaveLength(0);
    expect(screen.getByText("Enter an amount, such as 12.50.")).toBeTruthy();
  });

  it("retries a sale with the same key and starts an edited sale with a new one", async () => {
    const requests = renderForm();
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "24.50" } });
    fireEvent.change(screen.getByLabelText(/^Order reference/), { target: { value: "table-12" } });
    fireEvent.click(screen.getByRole("button", { name: "Show QR code" }));
    await settle();
    expect(screen.getByText("We could not start the checkout. Try again.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show QR code" }));
    await settle();
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Show QR code" }));
    await settle();

    expect(JSON.parse(requests[0]?.body ?? "")).toEqual({
      storeId: STORE.storeId,
      amountUsd: "24.50",
      reference: "table-12",
    });
    expect(requests[1]?.key).toBe(requests[0]?.key);
    expect(requests[2]?.key).not.toBe(requests[0]?.key);
  });
});
