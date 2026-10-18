// @vitest-environment jsdom
import { ToastProvider } from "@forwend/ui-web";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AcceptChange } from "@/features/jobs/components/accept-change";
import { JobDetail } from "@/features/jobs/components/job-detail";
import { ProposeChange } from "@/features/jobs/components/propose-change";
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
const TOKEN = "ab".repeat(32);
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));

type Call = { url: string; key: string | null; body: unknown };
const capture = (calls: Call[]) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      calls.push({
        url: new URL(request.url).pathname,
        key: request.headers.get("Idempotency-Key"),
        body: JSON.parse(await request.text()),
      });
      throw new TypeError("Failed to fetch");
    }),
  );

afterEach(cleanup);

describe("scope changes", () => {
  // R-105, R-106: the change the owner proposes, with one key per filled-in form.
  it("proposes a change in cents-exact decimals and retries with the same key", async () => {
    const calls: Call[] = [];
    capture(calls);
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <ToastProvider>
          <ProposeChange profileId={PROFILE} jobId={JOB_ID} onProposed={vi.fn()} />
        </ToastProvider>
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Propose a change" }));
    fireEvent.change(screen.getByLabelText("What the change is for"), {
      target: { value: "Extra page" },
    });
    fireEvent.change(screen.getByLabelText("Amount in USD"), { target: { value: "150.5" } });
    for (const _ of [1, 2]) {
      fireEvent.click(screen.getByRole("button", { name: "Propose change" }));
      await settle();
    }
    expect(calls.map((c) => c.url)).toEqual([
      `/api/v1/profiles/${PROFILE}/jobs/${JOB_ID}/payments`,
      `/api/v1/profiles/${PROFILE}/jobs/${JOB_ID}/payments`,
    ]);
    expect(calls[0]?.body).toEqual({ title: "Extra page", amountUsd: "150.50", dueDays: 14 });
    expect(calls[1]?.key).toBe(calls[0]?.key);
  });

  // R-105: the accept names the change by its proposedAt exactly as read, microseconds and all.
  it("accepts a change with the proposedAt it read, untouched", async () => {
    const calls: Call[] = [];
    capture(calls);
    const change = {
      position: 3,
      title: "Extra page",
      amountUsd: "150.00",
      dueDays: 7,
      onAccept: false,
      invoiceId: null,
      number: null,
      status: null,
      doneAt: null,
      deliveryLink: null,
      invoicedAt: null,
      paidAt: null,
      proposedAt: "2026-10-18T15:49:10.021548Z",
      acceptedName: null,
      acceptedAt: null,
    };
    render(
      <Provider store={makeStore({ getAccessToken: async () => null })}>
        <AcceptChange token={TOKEN} change={change} onAccepted={vi.fn()} />
      </Provider>,
    );
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Jane Doe" } });
    fireEvent.change(screen.getByLabelText("Your email"), {
      target: { value: "jane@bob.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Accept change" }));
    await settle();
    expect(calls[0]).toMatchObject({
      url: `/api/v1/jobs/${TOKEN}/payments/3/accept`,
      body: {
        name: "Jane Doe",
        email: "jane@bob.example",
        proposedAt: "2026-10-18T15:49:10.021548Z",
      },
    });
  });

  // R-106: with every agreed payment invoiced, the waiting change is not the next step; Withdraw takes it away.
  it("never offers Mark done for a waiting change, and withdraws it", async () => {
    const calls: { method: string; url: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        calls.push({ method: request.method, url: new URL(request.url).pathname });
        return new Response(null, { status: 204 });
      }),
    );
    const payment = (position: number, title: string, more: object = {}) => ({
      position,
      title,
      amountUsd: "300.00",
      dueDays: 14,
      onAccept: false,
      invoiceId: null,
      number: null,
      status: null,
      doneAt: null,
      deliveryLink: null,
      invoicedAt: null,
      paidAt: null,
      proposedAt: null,
      acceptedName: null,
      acceptedAt: null,
      acceptedEmail: null,
      ...more,
    });
    const invoiced = (number: number) => ({
      invoiceId: `0x${String(number).repeat(64)}`,
      number,
      status: "open",
      invoicedAt: "2026-10-18T10:00:00Z",
    });
    const job: Job = {
      jobId: JOB_ID,
      token: TOKEN,
      title: "Logo design",
      scope: null,
      client: {
        name: "Bob Ltd",
        email: "ap@bob.example",
        address: null,
        country: null,
        taxId: null,
      },
      issuer: {
        name: "Alice",
        address: "Main St 1",
        country: "DE",
        taxId: null,
        email: "a@x.example",
      },
      payments: [
        payment(1, "Deposit", { onAccept: true, ...invoiced(1) }),
        payment(2, "Final delivery", invoiced(2)),
        payment(3, "Extra page", { proposedAt: "2026-10-19T09:00:00.123456Z" }),
      ],
      totalUsd: "600.00",
      acceptedName: "Jane Doe",
      acceptedEmail: "jane@bob.example",
      acceptedAt: "2026-10-18T10:00:00Z",
      createdAt: "2026-10-18T09:00:00Z",
    };
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <ToastProvider>
          <JobDetail profileId={PROFILE} job={job} />
        </ToastProvider>
      </Provider>,
    );
    expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Propose a change" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    await settle();
    expect(calls).toContainEqual({
      method: "DELETE",
      url: `/api/v1/profiles/${PROFILE}/jobs/${JOB_ID}/payments/3`,
    });
    expect(screen.getByText("Extra page withdrawn")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Payments" }));
  });
});
