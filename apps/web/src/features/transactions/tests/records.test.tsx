// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from "@forwend/ui-web";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ExportTransactions } from "@/features/transactions/components/export-transactions";
import { RecordsCurrency } from "@/features/transactions/components/records-currency";
import { RecordsValue } from "@/features/transactions/components/records-value";
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
  recordsValue: null,
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
      // The export dialog also reads the records currency: none saved.
      if (url.pathname.endsWith("/records-currency")) return Response.json({ currency: null });
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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// The export's period is a kit date range picker: open it, press the first day, then the last; Escape after one
// press leaves the end open. October 2026 is in view.
const DAY = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeZone: "UTC" });
const dayButton = (iso: string) =>
  screen.getByRole("button", { name: DAY.format(new Date(`${iso}T00:00:00Z`)) });
const period = () => screen.getByRole("button", { name: /^Period / });
function pickRange(from: string, to?: string) {
  fireEvent.click(period());
  fireEvent.click(dayButton(from));
  if (to) fireEvent.click(dayButton(to));
  else fireEvent.keyDown(dayButton(from), { key: "Escape" });
}
const inOctober = () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
};

describe("records", () => {
  // R-109.
  it("links the invoice money in paid, and names what else a transaction was", () => {
    renderType({
      ...base,
      classification: "invoice",
      labelable: false,
      invoice: { invoiceId: `0x${"b".repeat(64)}`, number: 7, clientName: "Bob Ltd" },
    });
    expect(screen.getByRole("link", { name: "INV-0007 · Bob Ltd" }).getAttribute("href")).toBe(
      `/app/payments/0x${"b".repeat(64)}`,
    );
    cleanup();
    renderType({ ...base, classification: "own_transfer", labelable: false });
    expect(screen.getByText("Own transfer")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  // R-108, R-109.
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

  // R-109.
  it("exports the days chosen as the API's CSV, and says when it fails", async () => {
    inOctober();
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
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await settle();
    // A day before the start starts the period again, so the CSV asks from the 10th on.
    fireEvent.click(period());
    fireEvent.click(dayButton("2026-10-20"));
    fireEvent.click(dayButton("2026-10-10"));
    fireEvent.keyDown(dayButton("2026-10-10"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    await settle();
    // The dialog also reads the records currency.
    expect(calls.filter((c) => c.url.includes(".csv")).map((c) => c.url)).toEqual([
      `/api/v1/profiles/${PROFILE}/transactions.csv?from=2026-10-10`,
    ]);
    expect(await saved[0]?.text()).toBe("Date (UTC),Direction\r\n");
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe("forwend-transactions.csv");
    const dialog = document.querySelector("dialog");
    expect(dialog?.open).toBe(false);

    // R-118.
    answer(
      [],
      422,
      JSON.stringify({ error: { code: "too_many_transactions", message: "too many" } }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    await settle();
    expect(screen.getByRole("alert").textContent).toBe(
      "These days have too many transactions for one file. Choose a shorter period.",
    );
    document.querySelector("dialog")?.close();
    answer([], 500, JSON.stringify({ error: { code: "internal", message: "no" } }));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    await settle();
    expect(screen.getByRole("alert").textContent).toBe(
      "We could not export them. Check the days and try again.",
    );
    expect(dialog?.open).toBe(true);
    // Cancel closes it (jsdom has no form submit to a dialog).
    dialog?.close();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.queryByRole("alert")).toBeNull();
    click.mockRestore();
  });

  // R-111.
  it("saves the records currency when chosen, and keeps the saved one when that fails", async () => {
    const calls: Call[] = [];
    let saved: string | null = null;
    let failing = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        const body = await request.text();
        calls.push({ method: request.method, url: new URL(request.url).pathname, body });
        if (request.method === "PUT") {
          if (failing) return new Response("{}", { status: 500 });
          saved = JSON.parse(body).currency;
        }
        return new Response(JSON.stringify({ currency: saved }), {
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <RecordsCurrency profileId={PROFILE} />
      </Provider>,
    );
    await settle();
    expect(screen.getByRole("combobox", { name: "Records currency" }).textContent).toContain(
      "USD only",
    );
    await choose("EUR · Euro");
    expect(calls.filter((c) => c.method === "PUT")).toEqual([
      {
        method: "PUT",
        url: `/api/v1/profiles/${PROFILE}/records-currency`,
        body: '{"currency":"EUR"}',
      },
    ]);
    expect(screen.getByRole("combobox", { name: "Records currency" }).textContent).toContain("EUR");
    failing = true;
    await choose("USD only");
    expect(screen.getByText("We could not save the currency. Try again.")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Records currency" }).textContent).toContain("EUR");
  });

  it.each(["Download CSV", "Download statement (PDF)"])(
    "%s waits for the records currency to load and save, including after reopening",
    async (downloadLabel) => {
      inOctober();
      let finishRead: (() => void) | undefined;
      let finishSave: ((success: boolean) => void) | undefined;
      let loaded = false;
      let currency: string | null = null;
      let writes = 0;
      const exported: (string | null)[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (request: Request) => {
          if (request.method === "PUT") {
            writes += 1;
            const body = JSON.parse(await request.text());
            const success = await new Promise<boolean>((resolve) => {
              finishSave = resolve;
            });
            if (!success) return Response.json({}, { status: 500 });
            currency = body.currency;
            return Response.json({ currency });
          }
          if (request.url.endsWith("/records-currency")) {
            if (!loaded)
              await new Promise<void>((resolve) => {
                finishRead = () => {
                  loaded = true;
                  resolve();
                };
              });
            return Response.json({ currency });
          }
          exported.push(currency);
          return Response.json({}, { status: 500 });
        }),
      );
      render(
        <Provider store={makeStore({ getAccessToken: async () => "token" })}>
          <ExportTransactions profileId={PROFILE} disabled={false} />
        </Provider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Export" }));
      await settle();
      const download = () =>
        screen.getByRole("button", { name: downloadLabel }) as HTMLButtonElement;
      expect(download().disabled).toBe(true);
      finishRead?.();
      await waitFor(() => expect(download().disabled).toBe(false));
      pickRange("2026-10-01", "2026-10-31");
      await choose("EUR · Euro");
      expect(download().disabled).toBe(true);
      expect((screen.getByRole("combobox") as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(download());
      expect(exported).toEqual([]);
      document.querySelector("dialog")?.close();
      fireEvent.click(screen.getByRole("button", { name: "Export" }));
      await settle();
      expect(download().disabled).toBe(true);
      expect((screen.getByRole("combobox") as HTMLButtonElement).disabled).toBe(true);
      expect(writes).toBe(1);
      finishSave?.(false);
      await waitFor(() =>
        expect(screen.getByText("We could not save the currency. Try again.")).toBeTruthy(),
      );
      expect(download().disabled).toBe(true);
      await choose("EUR · Euro");
      expect(writes).toBe(2);
      finishSave?.(true);
      await waitFor(() => expect(download().disabled).toBe(false));
      fireEvent.click(download());
      await settle();
      expect(exported).toEqual(["EUR"]);
    },
  );

  it("recovers on reopening after the currency was saved but its response was lost", async () => {
    let currency: string | null = null;
    let holdRead = false;
    let finishRead: (() => void) | undefined;
    let writes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        if (request.method === "PUT") {
          writes += 1;
          currency = JSON.parse(await request.text()).currency;
          return Response.json({}, { status: 500 });
        }
        if (holdRead)
          await new Promise<void>((resolve) => {
            finishRead = resolve;
          });
        return Response.json({ currency });
      }),
    );
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <ExportTransactions profileId={PROFILE} disabled={false} />
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await settle();
    await choose("EUR · Euro");
    expect(screen.getByText("We could not save the currency. Try again.")).toBeTruthy();
    holdRead = true;
    document.querySelector("dialog")?.close();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await settle();
    for (const name of ["Download CSV", "Download statement (PDF)"])
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    expect(finishRead).toBeTypeOf("function");
    finishRead?.();
    await settle();
    expect(screen.getByRole("combobox").textContent).toContain("EUR");
    expect(writes).toBe(1);
    for (const name of ["Download CSV", "Download statement (PDF)"])
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("We could not save the currency. Try again.")).toBeNull();
  });

  it("blocks both exports when the records currency fails to load", async () => {
    let failing = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        failing ? Response.json({}, { status: 500 }) : Response.json({ currency: null }),
      ),
    );
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <ExportTransactions profileId={PROFILE} disabled={false} />
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await settle();
    expect(
      screen.getByText("We could not load the saved currency. Close and open this again."),
    ).toBeTruthy();
    for (const name of ["Download CSV", "Download statement (PDF)"])
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    failing = false;
    document.querySelector("dialog")?.close();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await settle();
    for (const name of ["Download CSV", "Download statement (PDF)"])
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(false);
  });

  // R-111.
  it("shows a value as money in its currency, with its rate's day", () => {
    render(
      <TooltipProvider>
        <RecordsValue value={{ currency: "EUR", amount: "1234567.89", rateDate: "2026-10-16" }} />
        <RecordsValue value={{ currency: "JPY", amount: "151", rateDate: "2026-10-13" }} />
      </TooltipProvider>,
    );
    // The reader's locale sets the separators, so the expected names are built with it.
    const money = (amount: number, currency: string, digits: number) =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(amount);
    const day = (iso: string) =>
      new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(
        new Date(`${iso}T00:00:00Z`),
      );
    expect(
      screen.getByRole("button", {
        name: `${money(1234567.89, "EUR", 2)}, At the ECB rate of ${day("2026-10-16")}`,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: `${money(151, "JPY", 0)}, At the ECB rate of ${day("2026-10-13")}`,
      }),
    ).toBeTruthy();
  });

  // R-113.
  it("downloads the statement of both days, and names what is missing", async () => {
    inOctober();
    const calls: Call[] = [];
    let answer = "pdf";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        const url = new URL(request.url);
        calls.push({ method: request.method, url: url.pathname + url.search, body: "" });
        if (url.pathname.endsWith("/records-currency")) return Response.json({ currency: null });
        if (answer === "missing")
          return Response.json(
            { error: { code: "billing_details_not_found", message: "no billing details" } },
            { status: 404 },
          );
        if (answer === "broken") return new Response("upstream down", { status: 500 });
        if (answer === "tooMany")
          return Response.json(
            { error: { code: "too_many_transactions", message: "too many" } },
            { status: 422 },
          );
        return new Response("%PDF-1.4", { headers: { "Content-Type": "application/pdf" } });
      }),
    );
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return "blob:pdf";
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <ExportTransactions profileId={PROFILE} disabled={false} />
      </Provider>,
    );
    const statements = () => calls.filter((c) => c.url.includes("statement")).map((c) => c.url);
    const ask = async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download statement (PDF)" }));
      await settle();
    };
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await settle();
    pickRange("2026-10-01");
    await ask();
    expect(period().getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(period());
    expect(screen.getByText("Choose both days: a statement covers a period.")).toBeTruthy();
    expect(statements()).toEqual([]);

    // The start is kept: one more press ends the period.
    fireEvent.click(period());
    fireEvent.click(dayButton("2026-10-31"));
    await ask();
    expect(statements()).toEqual([
      `/api/v1/profiles/${PROFILE}/statement.pdf?from=2026-10-01&to=2026-10-31`,
    ]);
    expect(await blobs[0]?.text()).toBe("%PDF-1.4");
    const saved = click.mock.contexts[0] as HTMLAnchorElement;
    expect([saved.href, saved.download]).toEqual([
      "blob:pdf",
      "forwend-statement-2026-10-01-to-2026-10-31.pdf",
    ]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:pdf");
    const dialog = document.querySelector("dialog");
    expect(dialog?.open).toBe(false);

    answer = "missing";
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await settle();
    await ask();
    expect(screen.getByRole("alert").textContent).toContain(
      "A statement names you by your billing details. Add them first.",
    );
    expect(screen.getByRole("link", { name: "Add billing details" }).getAttribute("href")).toBe(
      "/app/billing-details?then=transactions",
    );
    expect(dialog?.open).toBe(true);

    answer = "broken";
    await ask();
    expect(screen.getByRole("alert").textContent).toBe(
      "We could not make the statement. Try again.",
    );
    expect(screen.queryByRole("link", { name: "Add billing details" })).toBeNull();

    answer = "tooMany";
    await ask();
    expect(screen.getByRole("alert").textContent).toBe(
      "These days have too many transactions for one file. Choose a shorter period.",
    );
    click.mockRestore();
  });
});
