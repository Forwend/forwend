// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvoicesTable } from "@/features/invoices/components/invoices-table";
import { makeStore } from "@/store/store";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.stubGlobal("matchMedia", () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
}));

const NodeRequest = globalThis.Request;
vi.stubGlobal(
  "Request",
  class extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, "http://localhost") : input, init);
    }
  },
);

const ID = "0x7f3a9c1e5b2d4086a1c3e5f7092b4d6f8a0c2e4f6a8b0d2f4e6c8a0b2d4f6e81";
const SUMMARY = {
  invoiceId: ID,
  optionId: ID,
  optionLocked: false,
  optionCount: 1,
  confirming: false,
  closed: false,
  number: 1,
  title: "Logo design",
  note: null,
  dueDate: null,
  client: { name: "Acme", email: null, address: null },
  issuer: null,
  senderName: null,
  returnUrl: null,
  chainId: 84532,
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  amount: "1250000000",
  recipient: "0x1111111111111111111111111111111111111111",
  receiveAddress: "0x586134f74b654f5835860ca198ae725344670078",
  expiresAt: "2026-10-17T15:00:00Z",
  settleDeadline: "2026-10-18T15:00:00Z",
  paymentStatus: "open",
  settlementStatus: "none",
  settlementTxHash: null,
  createdAt: "2026-10-10T11:00:00Z",
};

vi.stubGlobal(
  "fetch",
  vi.fn(async (request: Request) =>
    new URL(request.url).searchParams.has("cursor")
      ? Response.json({ error: { code: "internal", message: "internal error" } }, { status: 500 })
      : Response.json({ items: [SUMMARY], nextCursor: "next" }),
  ),
);

afterEach(cleanup);

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));

describe("invoices list", () => {
  it("says so when Show more fails, instead of doing nothing", async () => {
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <InvoicesTable profileId="6f9619ff-8b86-4011-b42d-00c04fc964ff" tokens={[]} />
      </Provider>,
    );
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    await settle();

    expect(screen.getAllByText("INV-0001").length).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).not.toBeNull();
  });
});
