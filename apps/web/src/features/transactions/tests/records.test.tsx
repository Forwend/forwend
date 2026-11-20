// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from "@forwend/ui-web";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ExportTransactions } from "@/features/transactions/components/export-transactions";
import { RecordsCurrency } from "@/features/transactions/components/records-currency";
import { RecordsValue } from "@/features/transactions/components/records-value";
import { TransactionType } from "@/features/transactions/components/transaction-type";
import type { Transaction } from "@/features/transactions/types/transactions";
import { makeStore } from "@/store/store";

beforeAll(() => {
  // jsdom has no pointer capture or layout; Radix Select asks for both.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = vi.fn();
});

const PROFILE = "6f9619ff-8b86-4011-b42d-00c04fc964ff";
const HASH = `0x${"a".repeat(64)}`;
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
  feePaid: null,
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
const renderExport = () =>
  render(
    <Provider store={makeStore({ getAccessToken: async () => "token" })}>
      <ExportTransactions profileId={PROFILE} disabled={false} />
    </Provider>,
  );
const choose = async (name: string) => {
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
  fireEvent.keyDown(await screen.findByRole("option", { name }), { key: "Enter" });
};
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const openExport = async () => {
  fireEvent.click(button("Export"));
  await waitFor(() => expect(button("Download CSV").disabled).toBe(false));
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// The period picker: press the first day, then the last; Escape after one leaves the end open.
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
  it("labels money in, clears the label, and says when the API refuses", async () => {
    const calls: Call[] = [];
    answer(calls, 204);
    renderType(base);
    await choose("Income");
    await waitFor(() => expect(calls).toHaveLength(1));
    cleanup();
    renderType({ ...base, classification: "income" });
    await choose("Unclassified");
    await waitFor(() => expect(calls).toHaveLength(2));
    const url = `/api/v1/profiles/${PROFILE}/transactions/84532/${HASH}/0/label`;
    expect(calls).toEqual([
      { method: "PUT", url, body: '{"label":"income"}' },
      { method: "PUT", url, body: '{"label":null}' },
    ]);
    cleanup();
    answer([], 409, JSON.stringify({ error: { code: "not_labelable", message: "no" } }));
    renderType(base);
    await choose("Refund");
    expect(await screen.findByText("This transaction takes no type any more.")).toBeTruthy();
  });

  it("exports the days chosen as the API's CSV, and says why one fails", async () => {
    inOctober();
    const calls: Call[] = [];
    answer(calls, 200, "Date (UTC),Direction\r\n");
    const saved: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      saved.push(blob);
      return "blob:csv";
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderExport();
    await openExport();
    fireEvent.click(period());
    fireEvent.click(dayButton("2026-10-20"));
    fireEvent.click(dayButton("2026-10-10"));
    fireEvent.keyDown(dayButton("2026-10-10"), { key: "Escape" });
    fireEvent.click(button("Download CSV"));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(calls.filter((c) => c.url.includes(".csv")).map((c) => c.url)).toEqual([
      `/api/v1/profiles/${PROFILE}/transactions.csv?from=2026-10-10`,
    ]);
    expect(await saved[0]?.text()).toBe("Date (UTC),Direction\r\n");
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe("forwend-transactions.csv");
    expect(document.querySelector("dialog")?.open).toBe(false);

    answer(
      [],
      422,
      JSON.stringify({ error: { code: "too_many_transactions", message: "too many" } }),
    );
    await openExport();
    fireEvent.click(button("Download CSV"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "These days have too many transactions for one file. Choose a shorter period.",
    );
    answer([], 500, JSON.stringify({ error: { code: "internal", message: "no" } }));
    fireEvent.click(button("Download CSV"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "We could not export them. Check the days and try again.",
      ),
    );
    click.mockRestore();
  });

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
    const field = () => screen.getByRole("combobox", { name: "Records currency" });
    await waitFor(() => expect((field() as HTMLButtonElement).disabled).toBe(false));
    expect(field().textContent).toContain("USD only");
    await choose("EUR · Euro");
    await waitFor(() => expect((field() as HTMLButtonElement).disabled).toBe(false));
    expect(calls.filter((c) => c.method === "PUT")).toEqual([
      {
        method: "PUT",
        url: `/api/v1/profiles/${PROFILE}/records-currency`,
        body: '{"currency":"EUR"}',
      },
    ]);
    expect(field().textContent).toContain("EUR");
    failing = true;
    await choose("USD only");
    expect(await screen.findByText("We could not save the currency. Try again.")).toBeTruthy();
    expect(field().textContent).toContain("EUR");
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
      renderExport();
      fireEvent.click(button("Export"));
      const download = () => button(downloadLabel);
      await waitFor(() => expect(finishRead).toBeTypeOf("function"));
      expect(download().disabled).toBe(true);
      finishRead?.();
      await waitFor(() => expect(download().disabled).toBe(false));
      pickRange("2026-10-01", "2026-10-31");
      await choose("EUR · Euro");
      await waitFor(() => expect(writes).toBe(1));
      expect(download().disabled).toBe(true);
      expect((screen.getByRole("combobox") as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(download());
      expect(exported).toEqual([]);
      document.querySelector("dialog")?.close();
      fireEvent.click(button("Export"));
      expect(download().disabled).toBe(true);
      expect((screen.getByRole("combobox") as HTMLButtonElement).disabled).toBe(true);
      expect(writes).toBe(1);
      finishSave?.(false);
      expect(await screen.findByText("We could not save the currency. Try again.")).toBeTruthy();
      expect(download().disabled).toBe(true);
      await choose("EUR · Euro");
      await waitFor(() => expect(writes).toBe(2));
      finishSave?.(true);
      await waitFor(() => expect(download().disabled).toBe(false));
      fireEvent.click(download());
      await waitFor(() => expect(exported).toEqual(["EUR"]));
    },
  );

  it("recovers on reopening after the currency was saved but its response was lost", async () => {
    let currency: string | null = null;
    let holdRead = false;
    const held: (() => void)[] = [];
    let writes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        if (request.method === "PUT") {
          writes += 1;
          currency = JSON.parse(await request.text()).currency;
          return Response.json({}, { status: 500 });
        }
        if (holdRead) await new Promise<void>((resolve) => held.push(resolve));
        return Response.json({ currency });
      }),
    );
    renderExport();
    await openExport();
    await choose("EUR · Euro");
    expect(await screen.findByText("We could not save the currency. Try again.")).toBeTruthy();
    await waitFor(() => expect(button("Download CSV").disabled).toBe(true));
    holdRead = true;
    document.querySelector("dialog")?.close();
    fireEvent.click(button("Export"));
    await waitFor(() => expect(held.length).toBeGreaterThan(0));
    for (const name of ["Download CSV", "Download statement (PDF)"])
      expect(button(name).disabled).toBe(true);
    holdRead = false;
    for (const release of held) release();
    await waitFor(() => expect(button("Download CSV").disabled).toBe(false));
    expect(screen.getByRole("combobox").textContent).toContain("EUR");
    expect(writes).toBe(1);
    expect(button("Download statement (PDF)").disabled).toBe(false);
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
    renderExport();
    fireEvent.click(button("Export"));
    expect(
      await screen.findByText("We could not load the saved currency. Close and open this again."),
    ).toBeTruthy();
    for (const name of ["Download CSV", "Download statement (PDF)"])
      expect(button(name).disabled).toBe(true);
    failing = false;
    document.querySelector("dialog")?.close();
    await openExport();
    expect(button("Download statement (PDF)").disabled).toBe(false);
  });

  it("shows a value as money in its currency, with its rate's day", () => {
    render(
      <TooltipProvider>
        <RecordsValue value={{ currency: "EUR", amount: "1234567.89", rateDate: "2026-10-16" }} />
        <RecordsValue value={{ currency: "JPY", amount: "151", rateDate: "2026-10-13" }} />
      </TooltipProvider>,
    );
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

  it("downloads the statement of both days, and names what is missing", async () => {
    inOctober();
    const calls: Call[] = [];
    let reply = "pdf";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        const url = new URL(request.url);
        calls.push({ method: request.method, url: url.pathname + url.search, body: "" });
        if (url.pathname.endsWith("/records-currency")) return Response.json({ currency: null });
        if (reply === "missing")
          return Response.json(
            { error: { code: "billing_details_not_found", message: "no billing details" } },
            { status: 404 },
          );
        if (reply === "broken") return new Response("upstream down", { status: 500 });
        if (reply === "tooMany")
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
    renderExport();
    const statements = () => calls.filter((c) => c.url.includes("statement")).map((c) => c.url);
    const ask = () => fireEvent.click(button("Download statement (PDF)"));
    const alert = (text: string) =>
      waitFor(() => expect(screen.getByRole("alert").textContent).toContain(text));
    await openExport();
    pickRange("2026-10-01");
    ask();
    expect(period().getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(period());
    expect(statements()).toEqual([]);

    fireEvent.click(period());
    fireEvent.click(dayButton("2026-10-31"));
    ask();
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
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
    expect(document.querySelector("dialog")?.open).toBe(false);

    reply = "missing";
    await openExport();
    ask();
    await alert("A statement names you by your billing details. Add them first.");
    expect(screen.getByRole("link", { name: "Add billing details" }).getAttribute("href")).toBe(
      "/app/billing-details?then=transactions",
    );

    reply = "broken";
    ask();
    await alert("We could not make the statement. Try again.");
    expect(screen.queryByRole("link", { name: "Add billing details" })).toBeNull();

    reply = "tooMany";
    ask();
    await alert("These days have too many transactions for one file. Choose a shorter period.");
    click.mockRestore();
  });
});
