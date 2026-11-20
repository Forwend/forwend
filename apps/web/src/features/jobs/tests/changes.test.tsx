// @vitest-environment jsdom
import { ToastProvider } from "@forwend/ui-web";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobDetail } from "@/features/jobs/components/job-detail";
import { ProposeChange } from "@/features/jobs/components/propose-change";
import type { Job } from "@/features/jobs/types/jobs";
import { makeStore } from "@/store/store";

const PROFILE = "6f9619ff-8b86-4011-b42d-00c04fc964ff";
const JOB_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "ab".repeat(32);

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
  payToken: null,
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
  payToken: String(number).repeat(64),
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
const waiting = payment(3, "Extra page", { proposedAt: "2026-10-19T09:00:00.123456Z" });

afterEach(cleanup);

describe("scope changes", () => {
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
    const propose = () => screen.getByRole("button", { name: "Propose change" });
    for (const tries of [1, 2]) {
      fireEvent.click(propose());
      await waitFor(() => expect(calls).toHaveLength(tries));
      await waitFor(() => expect(propose().getAttribute("aria-busy")).not.toBe("true"));
    }
    expect(calls.map((c) => c.url)).toEqual([
      `/api/v1/profiles/${PROFILE}/jobs/${JOB_ID}/payments`,
      `/api/v1/profiles/${PROFILE}/jobs/${JOB_ID}/payments`,
    ]);
    expect(calls[0]?.body).toEqual({ title: "Extra page", amountUsd: "150.50", dueDays: 14 });
    expect(calls[1]?.key).toBe(calls[0]?.key);
  });

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
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "DELETE",
        url: `/api/v1/profiles/${PROFILE}/jobs/${JOB_ID}/payments/3`,
      }),
    );
  });

  it("holds the final while a change waits, and offers a change only until the job is finished", () => {
    answer(500, {});
    renderJob({
      ...accepted,
      payments: [deposit, payment(2, "Final delivery"), { ...waiting, clientEmailed: true }],
    });
    expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull();
    cleanup();
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
});
