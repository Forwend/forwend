// @vitest-environment jsdom
import { ToastProvider } from "@forwend/ui-web";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkDone } from "@/features/jobs/components/mark-done";
import type { Job } from "@/features/jobs/types/jobs";
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
// jsdom has no modal dialogs.
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
  this.open = true;
};

const PROFILE = "6f9619ff-8b86-4011-b42d-00c04fc964ff";
const JOB_ID = "11111111-1111-4111-8111-111111111111";
const INVOICE = `0x${"9".repeat(64)}`;
const payment = (position: number, more: object = {}) => ({
  position,
  title: position === 1 ? "Deposit" : "Final delivery",
  amountUsd: "300.00",
  dueDays: 14,
  onAccept: position === 1,
  invoiceId: null,
  number: null,
  status: null,
  doneAt: null,
  deliveryLink: null,
  ...more,
});
const job: Job = {
  jobId: JOB_ID,
  token: "ab".repeat(32),
  title: "Logo design",
  scope: null,
  client: { name: "Bob Ltd", email: "ap@bob.example", address: null, country: null, taxId: null },
  issuer: { name: "Alice", address: "Main St 1", country: "DE", taxId: null, email: "a@x.example" },
  payments: [
    payment(1, { invoiceId: `0x${"8".repeat(64)}`, number: 1, status: "paid" }),
    payment(2),
  ],
  totalUsd: "600.00",
  acceptedName: "Jane Doe",
  acceptedEmail: "jane@bob.example",
  acceptedAt: "2026-10-18T10:00:00Z",
  createdAt: "2026-10-18T09:00:00Z",
};
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));

afterEach(cleanup);

describe("mark done", () => {
  // R-103: the step is marked done with the delivery link, then its invoice goes out by Send to client.
  it("marks the step done with its link, then sends the invoice it made", async () => {
    const calls: { method: string; url: string; key: string | null; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        const url = new URL(request.url).pathname;
        calls.push({
          method: request.method,
          url,
          key: request.headers.get("Idempotency-Key"),
          body: await request.text(),
        });
        const done = {
          ...job,
          payments: [
            job.payments[0],
            payment(2, {
              invoiceId: INVOICE,
              number: 2,
              status: "open",
              doneAt: "2026-10-18T11:00:00Z",
            }),
          ],
        };
        return new Response(JSON.stringify(url.endsWith("/send") ? {} : done), {
          status: url.endsWith("/send") ? 500 : 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    const onDone = vi.fn();
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <ToastProvider>
          <MarkDone
            profileId={PROFILE}
            job={job}
            payment={job.payments[1] as Job["payments"][number]}
            onDone={onDone}
          />
        </ToastProvider>
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
    fireEvent.change(screen.getByLabelText("Link to the delivered work (optional)"), {
      target: { value: "https://drive.example/logo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mark done and send" }));
    await settle();
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: `/api/v1/profiles/${PROFILE}/jobs/${JOB_ID}/payments/2/done`,
      body: JSON.stringify({ deliveryLink: "https://drive.example/logo" }),
    });
    expect(calls[1]).toMatchObject({
      method: "POST",
      url: `/api/v1/profiles/${PROFILE}/invoices/${INVOICE}/send`,
    });
    expect(calls[1]?.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(onDone).toHaveBeenCalledWith(2);
    // The send failed here: the toast says the invoice is made but not emailed.
    expect(
      await screen.findByText(/INV-0002 is made, but it could not be emailed now/),
    ).toBeTruthy();
  });
});
