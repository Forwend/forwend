// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobForm } from "@/features/jobs/components/job-form";
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

const PROFILE = "6f9619ff-8b86-4011-b42d-00c04fc964ff";
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));

afterEach(cleanup);

describe("new job form", () => {
  // R-100, R-101.
  it("sends the schedule in cents-exact decimals and retries with the same key", async () => {
    const sent: { key: string | null; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        sent.push({
          key: request.headers.get("Idempotency-Key"),
          body: JSON.parse(await request.text()),
        });
        throw new TypeError("Failed to fetch");
      }),
    );
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <JobForm profileId={PROFILE} />
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create job" }));
    await settle();
    expect(sent).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByLabelText("Title"));

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Logo design" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Bob Ltd" } });
    fireEvent.change(screen.getByLabelText("Billing email"), {
      target: { value: "ap@bob.example" },
    });
    fireEvent.change(screen.getByLabelText("Amount in USD of payment 1"), {
      target: { value: "300" },
    });
    fireEvent.change(screen.getByLabelText("Amount in USD of payment 2"), {
      target: { value: "700.5" },
    });
    expect(screen.getByText("1,000.50 USD")).toBeTruthy();
    for (const _ of [1, 2]) {
      fireEvent.click(screen.getByRole("button", { name: "Create job" }));
      await settle();
    }
    expect(sent).toHaveLength(2);
    expect(sent[1]?.key).toBe(sent[0]?.key);
    expect(sent[0]?.body).toEqual({
      title: "Logo design",
      scope: "",
      client: { name: "Bob Ltd", email: "ap@bob.example", address: "", country: "", taxId: "" },
      payments: [
        { title: "Deposit", amountUsd: "300.00", dueDays: 7, onAccept: true },
        { title: "Final payment", amountUsd: "700.50", dueDays: 14, onAccept: false },
      ],
    });
  });
});
