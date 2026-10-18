// @vitest-environment jsdom
import { ToastProvider } from "@forwend/ui-web";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AcceptChange } from "@/features/jobs/components/accept-change";
import { JobDetail } from "@/features/jobs/components/job-detail";
import { MarkDone } from "@/features/jobs/components/mark-done";
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
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
  this.open = false;
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
  clientEmailed: false,
  ...more,
});
const invoiced = (number: number) => ({
  invoiceId: `0x${String(number).repeat(64)}`,
  number,
  status: "open",
  invoicedAt: "2026-10-18T10:00:00Z",
});
const deposit = payment(1, "Deposit", { onAccept: true, ...invoiced(1) });
const accepted: Job = {
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
    deposit,
    payment(2, "Final delivery", invoiced(2)),
    payment(3, "Extra page", { proposedAt: "2026-10-19T09:00:00.123456Z" }),
  ],
  totalUsd: "600.00",
  acceptedName: "Jane Doe",
  acceptedEmail: "jane@bob.example",
  acceptedAt: "2026-10-18T10:00:00Z",
  createdAt: "2026-10-18T09:00:00Z",
};

const answer = (status: number, body: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
const renderJob = (job: Job) =>
  render(
    <Provider store={makeStore({ getAccessToken: async () => "token" })}>
      <ToastProvider>
        <JobDetail profileId={PROFILE} job={job} />
      </ToastProvider>
    </Provider>,
  );
const propose = async () => {
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
  fireEvent.change(screen.getByLabelText("Amount in USD"), { target: { value: "150" } });
  fireEvent.click(screen.getByRole("button", { name: "Propose change" }));
  await settle();
};
const waiting = payment(3, "Extra page", { proposedAt: "2026-10-19T09:00:00.123456Z" });

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
        <AcceptChange token={TOKEN} change={change} onAccepted={vi.fn()} onGone={vi.fn()} />
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
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <ToastProvider>
          <JobDetail profileId={PROFILE} job={accepted} />
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

  // R-107: the toast names the address when the client was emailed; a finished job's 409 says to start a new job.
  it("says where the change's link went, and why a finished job takes no change", async () => {
    const emailed = { ...waiting, clientEmailed: true };
    answer(201, {
      ...accepted,
      payments: [deposit, payment(2, "Final delivery", invoiced(2)), emailed],
    });
    await propose();
    expect(
      screen.getByText(
        "Extra page proposed. The link to accept it is on its way to jane@bob.example.",
      ),
    ).toBeTruthy();
  });

  // A refused change makes the page read the job again, which takes the dialog away: the reason is a toast that stays.
  it("says in a toast why a change or the final was refused, and closes the dialog", async () => {
    const dialogOpen = () => document.querySelector("dialog")?.open;
    answer(409, { error: { code: "job_finished", message: "the job's last payment is done" } });
    await propose();
    expect(
      screen.getByText("The last payment is done. Start a new job for more work."),
    ).toBeTruthy();
    expect(dialogOpen()).toBe(false);
    cleanup();
    answer(409, { error: { code: "change_pending", message: "a change waits" } });
    await propose();
    expect(screen.getByText("A change already waits for the client.")).toBeTruthy();
    expect(dialogOpen()).toBe(false);
    cleanup();
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <ToastProvider>
          <MarkDone
            profileId={PROFILE}
            job={accepted}
            payment={payment(2, "Final delivery")}
            onDone={vi.fn()}
          />
        </ToastProvider>
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark done and send" }));
    await settle();
    expect(screen.getByText(/^A change waits for the client\. Withdraw it/)).toBeTruthy();
    expect(dialogOpen()).toBe(false);
  });

  // R-105: the final invoice waits for a waiting change; a finished job takes no change, but a deposit-only one does.
  it("holds the final while a change waits, and offers a change only until the job is finished", () => {
    answer(500, {});
    renderJob({
      ...accepted,
      payments: [deposit, payment(2, "Final delivery"), { ...waiting, clientEmailed: true }],
    });
    expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull();
    expect(screen.getByText(/The final invoice waits for the change/)).toBeTruthy();
    expect(screen.getByText(/The link was sent to jane@bob.example\./)).toBeTruthy();
    cleanup();
    // An earlier step is no final, so it can be marked done while a change waits.
    renderJob({
      ...accepted,
      payments: [
        deposit,
        payment(2, "Design"),
        payment(3, "Final delivery"),
        { ...waiting, position: 4 },
      ],
    });
    expect(screen.getByRole("button", { name: "Mark done" })).toBeTruthy();
    expect(screen.queryByText(/The final invoice waits for the change/)).toBeNull();
    cleanup();
    const done = { ...invoiced(2), doneAt: "2026-10-19T10:00:00Z" };
    renderJob({
      ...accepted,
      payments: [deposit, payment(2, "Final delivery", done)],
    });
    expect(screen.queryByRole("button", { name: "Propose a change" })).toBeNull();
    cleanup();
    renderJob({ ...accepted, payments: [deposit] });
    expect(screen.getByRole("button", { name: "Propose a change" })).toBeTruthy();
  });

  // R-106: a change withdrawn or replaced before the accept is the page's to say, since its form goes.
  it("tells the page when the change it read is gone", async () => {
    answer(404, { error: { code: "job_not_found", message: "job not found" } });
    const onAccepted = vi.fn();
    const onGone = vi.fn();
    render(
      <Provider store={makeStore({ getAccessToken: async () => null })}>
        <AcceptChange token={TOKEN} change={waiting} onAccepted={onAccepted} onGone={onGone} />
      </Provider>,
    );
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Jane Doe" } });
    fireEvent.change(screen.getByLabelText("Your email"), {
      target: { value: "jane@bob.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Accept change" }));
    await settle();
    expect(onGone).toHaveBeenCalledOnce();
    expect(onAccepted).not.toHaveBeenCalled();
  });
});
