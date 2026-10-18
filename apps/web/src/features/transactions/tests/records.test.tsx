// @vitest-environment jsdom
import { ToastProvider } from "@forwend/ui-web";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ExportTransactions } from "@/features/transactions/components/export-transactions";
import { TransactionType } from "@/features/transactions/components/transaction-type";
import type { Transaction } from "@/features/transactions/types/transactions";
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
beforeAll(() => {
  // jsdom has no modal dialogs, pointer capture or layout; Radix Select asks for the last two.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = vi.fn();
});

const PROFILE = "6f9619ff-8b86-4011-b42d-00c04fc964ff";
const HASH = `0x${"a".repeat(64)}`;
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));
const base: Transaction = {
  chainId: 84532,
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  symbol: "USDC",
  decimals: 6,
  direction: "in",
  amount: "1500000",
  counterparty: "0xabcd000000000000000000000000000000000001",
  txHash: HASH,
  logIndex: 0,
  blockNumber: 10,
  at: "2026-10-10T08:00:00Z",
  status: "confirmed",
  usdValue: "1.500000",
  classification: "unclassified",
  labelable: true,
  invoice: null,
};

type Call = { method: string; url: string; body: string };
const answer = (calls: Call[], status: number, body = "") =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      calls.push({
        method: request.method,
        url: url.pathname + url.search,
        body: await request.text(),
      });
      return new Response(status === 204 ? null : body, {
        status,
        headers: { "Content-Type": status < 300 ? "text/csv" : "application/json" },
      });
    }),
  );
const renderType = (t: Transaction) =>
  render(
    <Provider store={makeStore({ getAccessToken: async () => "token" })}>
      <ToastProvider>
        <TransactionType profileId={PROFILE} t={t} />
      </ToastProvider>
    </Provider>,
  );
const choose = async (name: string) => {
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
  fireEvent.keyDown(await screen.findByRole("option", { name }), { key: "Enter" });
  await settle();
};

afterEach(cleanup);

describe("records", () => {
  // R-109: an invoice payment links its invoice; anything Forwend classified is text.
  it("links the invoice money in paid, and names what else a transaction was", () => {
    renderType({
      ...base,
      classification: "invoice",
      labelable: false,
      invoice: { invoiceId: `0x${"b".repeat(64)}`, number: 7, clientName: "Bob Ltd" },
    });
    expect(screen.getByRole("link", { name: "INV-0007 · Bob Ltd" }).getAttribute("href")).toBe(
      `/app/invoices/0x${"b".repeat(64)}`,
    );
    cleanup();
    renderType({ ...base, classification: "own_transfer", labelable: false });
    expect(screen.getByText("Own transfer")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  // R-108, R-109: the select saves the label, Unclassified clears it, and a refusal says so.
  it("labels money in, clears the label, and says when the API refuses", async () => {
    const calls: Call[] = [];
    answer(calls, 204);
    renderType(base);
    await choose("Income");
    cleanup();
    renderType({ ...base, classification: "income" });
    await choose("Unclassified");
    const url = `/api/v1/profiles/${PROFILE}/transactions/84532/${HASH}/0/label`;
    expect(calls).toEqual([
      { method: "PUT", url, body: '{"label":"income"}' },
      { method: "PUT", url, body: '{"label":null}' },
    ]);
    cleanup();
    answer([], 409, JSON.stringify({ error: { code: "not_labelable", message: "no" } }));
    renderType(base);
    await choose("Refund");
    expect(screen.getByText("This transaction takes no type any more.")).toBeTruthy();
  });

  // R-109: the export asks for the days chosen and saves the API's CSV; a failure stays in the dialog until it opens
  // again.
  it("exports the days chosen as the API's CSV, and says when it fails", async () => {
    const calls: Call[] = [];
    answer(calls, 200, "Date (UTC),Direction\r\n");
    const saved: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      saved.push(blob);
      return "blob:csv";
    });
    URL.revokeObjectURL = vi.fn();
    // jsdom can't follow a download link.
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <ExportTransactions profileId={PROFILE} disabled={false} />
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    await settle();
    expect(calls.map((c) => c.url)).toEqual([
      `/api/v1/profiles/${PROFILE}/transactions.csv?from=2026-10-01`,
    ]);
    expect(await saved[0]?.text()).toBe("Date (UTC),Direction\r\n");
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe("forwend-transactions.csv");
    const dialog = document.querySelector("dialog");
    expect(dialog?.open).toBe(false);

    answer([], 500, JSON.stringify({ error: { code: "internal", message: "no" } }));
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    await settle();
    expect(screen.getByRole("alert").textContent).toBe(
      "We could not export them. Check the days and try again.",
    );
    expect(dialog?.open).toBe(true);
    // Cancel closes it (jsdom has no form submit to a dialog).
    dialog?.close();
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(screen.queryByRole("alert")).toBeNull();
    click.mockRestore();
  });
});
