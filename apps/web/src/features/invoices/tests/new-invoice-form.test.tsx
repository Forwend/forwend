// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewInvoiceForm } from "@/features/invoices/components/new-invoice-form";
import { makeStore } from "@/store/store";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const NodeRequest = globalThis.Request;
vi.stubGlobal(
  "Request",
  class extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, "http://localhost") : input, init);
    }
  },
);

const TOKEN = {
  chainId: 84532,
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  symbol: "USDC",
  decimals: 6,
};
const PROFILE = "6f9619ff-8b86-4011-b42d-00c04fc964ff";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));

describe("new invoice form", () => {
  it("retries with the same Idempotency-Key after a network error when the checkout closes at a custom time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T10:00:00Z"));
    const keys: (string | null)[] = [];
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        keys.push(request.headers.get("Idempotency-Key"));
        bodies.push(await request.text());
        throw new TypeError("Failed to fetch");
      }),
    );
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <NewInvoiceForm profileId={PROFILE} tokens={[TOKEN]} />
      </Provider>,
    );
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "100" } });
    fireEvent.click(screen.getByLabelText("Custom"));
    fireEvent.click(screen.getByRole("button", { name: /Closes on/ }));
    // Three days from now, at the default 17:00.
    const days = within(screen.getByRole("grid"))
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-disabled") !== "true");
    fireEvent.click(days[3] as HTMLElement);

    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    await settle();
    expect(screen.getByText("We could not create the invoice. Try again.")).toBeTruthy();

    vi.setSystemTime(new Date("2026-10-14T10:00:02Z"));
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    await settle();

    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(bodies[1]).toBe(bodies[0]);
  });
});
