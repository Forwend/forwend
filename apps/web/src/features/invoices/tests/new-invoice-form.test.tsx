// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientSearch } from "@/features/clients/hooks/use-client-search";
import type { Client } from "@/features/clients/types/clients";
import { NewInvoiceForm } from "@/features/invoices/components/new-invoice-form";
import { makeStore } from "@/store/store";

// Each test walks the steps and waits on the real 400 ms fee quote: 5 s was too short on CI.
vi.setConfig({ testTimeout: 15_000 });

// The picker's API search as the form sees it: every saved client already found.
const found = (clients: Client[]): ClientSearch => ({
  any: true,
  clients,
  pending: false,
  failed: false,
  search: () => {},
});

// The preview beside the form repeats its values, so value checks look inside the form itself.
const form = () => within(document.querySelector("form") as HTMLElement);

/** Steps to Review and presses Create; a step whose check fails stops there. */
async function create() {
  for (let i = 0; i < 4; i++) {
    const button = screen.queryByRole("button", { name: "Create invoice" });
    if (button) {
      fireEvent.click(button);
      return;
    }
    const at = () => document.querySelector('[aria-current="step"]')?.textContent;
    const before = at();
    const next = screen.getByRole("button", { name: /^Continue/ });
    await waitFor(() => expect(next.hasAttribute("disabled")).toBe(false), { timeout: 2000 });
    fireEvent.click(next);
    if (at() === before) return;
  }
}

/** Answers the fee quote with no fees for the typed price, and leaves every other request to send. */
function stubFetch(send: (request: Request) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      if (request.method !== "GET" || !url.pathname.endsWith("/fees")) return send(request);
      const usd = url.searchParams.get("amountUsd");
      const price = usd
        ? String(Math.round(Number(usd) * 10 ** TOKEN.decimals))
        : (url.searchParams.get("amount") ?? "0");
      return new Response(
        JSON.stringify({
          feesPaidBy: "owner",
          options: [{ ...TOKEN, price, networkFee: "0", platformFee: "0" }],
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }),
  );
}

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

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

describe("new invoice form", () => {
  it("retries with the same Idempotency-Key after a network error when the checkout closes at a custom time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T10:00:00Z"));
    const keys: (string | null)[] = [];
    const bodies: string[] = [];
    stubFetch(
      vi.fn(async (request: Request) => {
        keys.push(request.headers.get("Idempotency-Key"));
        bodies.push(await request.text());
        throw new TypeError("Failed to fetch");
      }),
    );
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <NewInvoiceForm profileId={PROFILE} testnet tokens={[TOKEN]} />
      </Provider>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: /^(Legal|Full) name$/ }), {
      target: { value: "Mara Ilić" },
    });
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "100" } });
    fireEvent.click(screen.getByLabelText("Custom"));
    fireEvent.click(screen.getByRole("button", { name: /Closes on/ }));
    // Three days from now, at the default 17:00.
    const days = within(screen.getByRole("grid"))
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-disabled") !== "true");
    fireEvent.click(days[3] as HTMLElement);

    await create();
    await waitFor(() =>
      expect(screen.getByText("We could not create the invoice. Try again.")).toBeTruthy(),
    );

    vi.setSystemTime(new Date("2026-10-14T10:00:02Z"));
    await create();
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[1]).toBe(keys[0]);
    expect(bodies[1]).toBe(bodies[0]);
  });

  it("shows the network fee, what the client pays and what the owner receives, and sends who pays", async () => {
    const created: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        if (request.method === "GET" && new URL(request.url).pathname.endsWith("/fees"))
          return new Response(
            JSON.stringify({
              feesPaidBy: "owner",
              options: [{ ...TOKEN, price: "100000000", networkFee: "50000", platformFee: "0" }],
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        created.push(JSON.parse(await request.text()));
        throw new TypeError("Failed to fetch");
      }),
    );
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <NewInvoiceForm profileId={PROFILE} testnet tokens={[TOKEN]} />
      </Provider>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: /^(Legal|Full) name$/ }), {
      target: { value: "Mara Ilić" },
    });
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "100" } });
    await form().findByText("− 0.05 USDC", undefined, { timeout: 2000 });
    const row = (term: string) => form().getByText(term).nextElementSibling?.textContent;
    expect(row("Subtotal")).toBe("100.00 USDC");
    expect(row("Client pays")).toBe("100.00 USDC");
    expect(row("You receive")).toBe("99.95 USDC");
    fireEvent.click(form().getByRole("radio", { name: "Client pays it" }));
    expect(row("Network fee")).toBe("+ 0.05 USDC");
    expect(row("Client pays")).toBe("100.05 USDC");
    expect(row("You receive")).toBe("100.00 USDC");
    await create();
    await waitFor(() => expect(created.at(-1)?.feesPaidBy).toBe("client"));
  });
  it("fills the client from a saved client and sends its details", async () => {
    const bodies: Record<string, unknown>[] = [];
    stubFetch(
      vi.fn(async (request: Request) => {
        bodies.push(JSON.parse(await request.text()));
        throw new TypeError("Failed to fetch");
      }),
    );
    const client = {
      clientId: "11111111-1111-4111-8111-111111111111",
      name: "Bob Ltd",
      email: "ap@bob.example",
      address: "Main St 1\nBerlin",
      country: "DE",
      taxId: "DE999999999",
      reference: "PO-4500012345",
      reminders: false,
      updatedAt: "2026-10-16T10:00:00Z",
    };
    // jsdom has no layout, and the select's list scrolls its chosen option into view.
    Element.prototype.scrollIntoView = vi.fn();
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <NewInvoiceForm
          profileId={PROFILE}
          testnet
          tokens={[TOKEN]}
          clientSearch={found([client])}
        />
      </Provider>,
    );
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: /^Saved client/ }));
    fireEvent.change(screen.getByRole("combobox", { name: /Saved client/ }), {
      target: { value: "bob" },
    });
    fireEvent.click(await screen.findByRole("option", { name: /^Bob Ltd/ }));
    expect((screen.getByLabelText("Tax or VAT ID") as HTMLInputElement).value).toBe("DE999999999");
    expect((screen.getByLabelText(/^PO or reference/) as HTMLInputElement).value).toBe(
      "PO-4500012345",
    );

    await create();
    await waitFor(() =>
      expect(bodies[0]?.client).toEqual({
        name: "Bob Ltd",
        email: "ap@bob.example",
        address: "Main St 1\nBerlin",
        country: "DE",
        taxId: "DE999999999",
      }),
    );
    expect(bodies[0]?.reference).toBe("PO-4500012345");
  });
  it("sends items whose total is the amount, unit prices in the amount's own unit", async () => {
    const bodies: Record<string, unknown>[] = [];
    stubFetch(
      vi.fn(async (request: Request) => {
        bodies.push(JSON.parse(await request.text()));
        throw new TypeError("Failed to fetch");
      }),
    );
    const other = {
      ...TOKEN,
      chainId: 11155111,
      token: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
    };
    const fill = (tokens: (typeof TOKEN)[]) => {
      render(
        <Provider store={makeStore({ getAccessToken: async () => "token" })}>
          <NewInvoiceForm profileId={PROFILE} testnet tokens={tokens} />
        </Provider>,
      );
      fireEvent.change(screen.getByRole("textbox", { name: /^(Legal|Full) name$/ }), {
        target: { value: "Mara Ilić" },
      });
      fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "100" } });
      fireEvent.click(screen.getByRole("button", { name: "Add item" }));
      fireEvent.change(screen.getByLabelText("Item 1"), { target: { value: "Design" } });
      fireEvent.change(screen.getByLabelText("Qty"), { target: { value: "7.5" } });
      fireEvent.click(screen.getByRole("button", { name: "Add item" }));
      fireEvent.change(screen.getByLabelText("Item 2"), { target: { value: "Hosting" } });
      fireEvent.change(screen.getAllByLabelText(/^Price/)[1] as HTMLElement, {
        target: { value: "0.5" },
      });
    };

    fill([TOKEN]);
    expect(form().getByText("Subtotal").nextElementSibling?.textContent).toBe("750.50 USDC");
    await create();
    await waitFor(() =>
      expect(bodies[0]).toMatchObject({
        amount: "750500000",
        lines: [
          { description: "Design", quantity: "7.5", unitPrice: "100000000" },
          { description: "Hosting", quantity: "1", unitPrice: "500000" },
        ],
      }),
    );

    fireEvent.change(screen.getAllByLabelText("Qty")[1] as HTMLElement, {
      target: { value: "0.5" },
    });
    fireEvent.change(screen.getAllByLabelText(/^Price/)[1] as HTMLElement, {
      target: { value: "0.000001" },
    });
    await create();
    await waitFor(() =>
      expect(screen.getByText("Qty × price needs more decimals than USDC has.")).toBeTruthy(),
    );
    expect(bodies).toHaveLength(1);
    cleanup();

    fill([TOKEN, other]);
    await create();
    await waitFor(() =>
      expect(bodies[1]).toMatchObject({
        amountUsd: "750.5",
        lines: [
          { description: "Design", quantity: "7.5", unitPrice: "100" },
          { description: "Hosting", quantity: "1", unitPrice: "0.5" },
        ],
      }),
    );
    expect(bodies[1]).not.toHaveProperty("amount");
  });

  it("stops on the items when they add up to less than 1.00, and sends nothing", async () => {
    const send = vi.fn(async () => Response.json({}, { status: 201 }));
    stubFetch(send);
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <NewInvoiceForm profileId={PROFILE} testnet tokens={[TOKEN]} />
      </Provider>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: /^(Legal|Full) name$/ }), {
      target: { value: "Mara Ilić" },
    });
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "0.3" } });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    fireEvent.change(screen.getByLabelText("Item 1"), { target: { value: "Finance" } });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    fireEvent.change(screen.getByLabelText("Item 2"), { target: { value: "Finance" } });
    fireEvent.change(screen.getAllByLabelText(/^Price/)[1] as HTMLElement, {
      target: { value: "0.3" },
    });
    await create();
    await waitFor(() =>
      expect(document.querySelector('[aria-current="step"]')?.textContent).toContain("Items"),
    );
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toContain(
      "The items must add up to at least 1.00 USDC.",
    );
    expect(send).not.toHaveBeenCalled();

    fireEvent.change(screen.getAllByLabelText(/^Price/)[1] as HTMLElement, {
      target: { value: "0.7" },
    });
    await create();
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  });

  it("shows each item's amount and the total exactly, not cut to cents", () => {
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <NewInvoiceForm profileId={PROFILE} testnet tokens={[TOKEN]} />
      </Provider>,
    );
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "12.345" } });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    fireEvent.change(screen.getByLabelText("Item 1"), { target: { value: "Design" } });
    expect(form().getByText("Subtotal").parentElement?.textContent).toBe("Subtotal12.345 USDC");
    expect(screen.queryByText("12.34 USDC")).toBeNull();
  });

  it("shows a refused amount under the items", async () => {
    stubFetch(
      vi.fn(async () =>
        Response.json(
          {
            error: {
              code: "invalid_value",
              message: "invalid invoice request: amountUsd has more decimals than USDC can hold",
            },
          },
          { status: 422 },
        ),
      ),
    );
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <NewInvoiceForm profileId={PROFILE} testnet tokens={[TOKEN]} />
      </Provider>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: /^(Legal|Full) name$/ }), {
      target: { value: "Mara Ilić" },
    });
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    fireEvent.change(screen.getByLabelText("Item 1"), { target: { value: "Design" } });
    await create();
    await waitFor(() =>
      expect(screen.getAllByRole("alert").map((a) => a.textContent)).toContain(
        "Enter at least 1.00 in an amount every accepted token can hold.",
      ),
    );
  });
  it("sends the invoice it replaces, and says when that one can no longer be replaced", async () => {
    const bodies: { replaces?: string }[] = [];
    stubFetch(
      vi.fn(async (request: Request) => {
        bodies.push(await request.json());
        return Response.json(
          { error: { code: "invoice_not_cancelable", message: "x" } },
          { status: 409 },
        );
      }),
    );
    const old = `0x${"7".repeat(64)}`;
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <NewInvoiceForm
          profileId={PROFILE}
          testnet
          tokens={[TOKEN]}
          replaces={{ invoiceId: old, number: "INV-0007" }}
        />
      </Provider>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: /^(Legal|Full) name$/ }), {
      target: { value: "Mara Ilić" },
    });
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "5" } });
    await create();
    await waitFor(() => expect(bodies.map((b) => b.replaces)).toEqual([old]));
    expect(screen.getAllByRole("alert").some((a) => a.textContent?.includes("INV-0007"))).toBe(
      true,
    );
  });

  it("drops the last figures when a new quote is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        const url = new URL(request.url);
        if (url.searchParams.get("feesPaidBy") === "owner")
          return new Response(
            JSON.stringify({ error: { code: "invalid_value", message: "too small for its fees" } }),
            { status: 422, headers: { "Content-Type": "application/json" } },
          );
        return new Response(
          JSON.stringify({
            feesPaidBy: "client",
            options: [{ ...TOKEN, price: "100000000", networkFee: "50000", platformFee: "0" }],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <NewInvoiceForm profileId={PROFILE} testnet tokens={[TOKEN]} feesPaidBy="client" />
      </Provider>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: /^(Legal|Full) name$/ }), {
      target: { value: "Mara Ilić" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Continue/ }));
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "100" } });
    await form().findByText("+ 0.05 USDC", undefined, { timeout: 2000 });
    fireEvent.click(form().getByRole("radio", { name: "You pay it" }));
    await waitFor(() =>
      expect(form().getByText("Network fee").nextElementSibling?.textContent).toBe("—"),
    );
    expect(form().getByText("You receive").nextElementSibling?.textContent).toBe("—");
    expect(screen.getByRole("button", { name: /^Continue/ }).hasAttribute("disabled")).toBe(false);
  });

  it("sends a copied invoice's amount, items and details as they were", async () => {
    const bodies: Record<string, unknown>[] = [];
    stubFetch(
      vi.fn(async (request: Request) => {
        bodies.push(JSON.parse(await request.text()));
        throw new TypeError("Failed to fetch");
      }),
    );
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <NewInvoiceForm
          profileId={PROFILE}
          testnet
          tokens={[TOKEN]}
          start={{
            payWith: "fixed",
            picked: `${TOKEN.chainId}:${TOKEN.token}`,
            reminders: false,
            amount: "5",
            items: [
              { id: "0", description: "Design", quantity: "7.5", price: "0.5" },
              { id: "1", description: "Hosting", quantity: "1", price: "1.25" },
            ],
            title: "Website",
            note: "Thanks",
            returnUrl: "https://shop.example/thanks",
            reference: "PO-1",
            agreed: { currency: "EUR", amount: "4.6", date: "2026-10-01" },
            client: { name: "Bob Ltd", email: "", address: "", country: "", taxId: "" },
          }}
        />
      </Provider>,
    );
    await create();
    await waitFor(() =>
      expect(bodies[0]).toMatchObject({
        amount: "5000000",
        title: "Website",
        note: "Thanks",
        returnUrl: "https://shop.example/thanks",
        reference: "PO-1",
        agreedValue: { currency: "EUR", amount: "4.6", date: "2026-10-01" },
        dueDate: "",
        supplyDate: "",
        lines: [
          { description: "Design", quantity: "7.5", unitPrice: "500000" },
          { description: "Hosting", quantity: "1", unitPrice: "1250000" },
        ],
      }),
    );
  });
  it("adds an agreed value and names what is missing", async () => {
    const bodies: Record<string, unknown>[] = [];
    stubFetch(
      vi.fn(async (request: Request) => {
        bodies.push(JSON.parse(await request.text()));
        throw new TypeError("Failed to fetch");
      }),
    );
    Element.prototype.scrollIntoView = vi.fn();
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <NewInvoiceForm profileId={PROFILE} testnet tokens={[TOKEN]} />
      </Provider>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: /^(Legal|Full) name$/ }), {
      target: { value: "Mara Ilić" },
    });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Add agreed value" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Agreed in/ }));
    await create();
    await waitFor(() => expect(screen.getByText("Choose a currency.")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /^Agreed in/ }));
    fireEvent.change(screen.getByRole("combobox", { name: /Agreed in/ }), {
      target: { value: "yen" },
    });
    fireEvent.click(await screen.findByRole("option", { name: /^JPY/ }));
    fireEvent.change(screen.getByLabelText("Agreed amount"), { target: { value: "1.5" } });
    await create();
    await waitFor(() => expect(screen.getByText("Enter a whole amount above 0.")).toBeTruthy());
    expect(bodies).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Agreed amount"), { target: { value: "15000" } });
    await create();
    await waitFor(() =>
      expect(bodies[0]?.agreedValue).toMatchObject({
        currency: "JPY",
        amount: "15000",
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
  });
  it("repeats every month only with a due date and a client email", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T10:00:00Z"));
    const bodies: Record<string, unknown>[] = [];
    stubFetch(
      vi.fn(async (request: Request) => {
        bodies.push(JSON.parse(await request.text()));
        throw new TypeError("Failed to fetch");
      }),
    );
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <NewInvoiceForm profileId={PROFILE} testnet tokens={[TOKEN]} />
      </Provider>,
    );
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "100" } });
    const repeat = screen.getByRole("checkbox", { name: "Repeat every month" });
    fireEvent.click(repeat);
    await create();
    expect(bodies).toHaveLength(0);
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: /^(Legal|Full) name$/ }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: /^(Legal|Full) name$/ }), {
      target: { value: "Bob Ltd" },
    });
    await create();
    expect(bodies).toHaveLength(0);
    expect(screen.getByText("Repeating needs a due date and a client email.")).toBeTruthy();
    expect(repeat.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(repeat);

    const pick = (field: RegExp, day: (enabled: HTMLElement[]) => HTMLElement) => {
      fireEvent.click(screen.getByRole("button", { name: field }));
      const days = within(screen.getByRole("grid"))
        .getAllByRole("button")
        .filter((b) => b.getAttribute("aria-disabled") !== "true");
      fireEvent.click(day(days));
    };
    pick(/^Due date/, (days) => days[10] as HTMLElement);
    pick(/^Last due date/, (days) => days.at(-1) as HTMLElement);
    fireEvent.change(form().getByLabelText(/^Email/), { target: { value: "ap@bob.example" } });
    const due = (document.querySelector('input[name="dueDate"]') as HTMLInputElement).value;
    const end = (document.querySelector('input[name="repeatEndDate"]') as HTMLInputElement).value;
    expect(end > due).toBe(true);
    await create();
    await waitFor(() => expect(bodies[0]?.dueDate).toBe(due));
    expect(bodies[0]?.repeat).toEqual({ endDate: end });
  });
});

it("requires an invoice recipient while accepting an individual without business details", async () => {
  const send = vi.fn(async () => {
    throw new TypeError("Failed to fetch");
  });
  stubFetch(send);
  render(
    <Provider store={makeStore({ getAccessToken: async () => "token" })}>
      <NewInvoiceForm profileId={PROFILE} testnet tokens={[TOKEN]} />
    </Provider>,
  );
  fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "10" } });
  await create();
  expect(send).not.toHaveBeenCalled();
  expect(
    screen.getByRole("textbox", { name: /^(Legal|Full) name$/ }).getAttribute("aria-invalid"),
  ).toBe("true");
  fireEvent.change(screen.getByRole("textbox", { name: /^(Legal|Full) name$/ }), {
    target: { value: "Mara Ilić" },
  });
  await create();
  await waitFor(() => expect(send).toHaveBeenCalledOnce());
});

it("reviews who is billed, what the client pays and what the owner receives", async () => {
  stubFetch(() => new Response("{}"));
  render(
    <Provider store={makeStore({ getAccessToken: async () => "token" })}>
      <NewInvoiceForm profileId={PROFILE} testnet tokens={[TOKEN]} />
    </Provider>,
  );
  // The form reads what is typed on input, as a keyboard sends it.
  fireEvent.input(screen.getByRole("textbox", { name: /^(Legal|Full) name$/ }), {
    target: { value: "Mara Ilić" },
  });
  fireEvent.input(screen.getByRole("textbox", { name: /^Email/ }), {
    target: { value: "mara@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue to Items" }));
  fireEvent.click(screen.getByRole("button", { name: "Add item" }));
  fireEvent.change(screen.getByLabelText("Item 1"), { target: { value: "Design" } });
  fireEvent.change(screen.getByLabelText(/^Price/), { target: { value: "100" } });
  const next = screen.getByRole("button", { name: "Continue to Details" });
  await waitFor(() => expect(next.hasAttribute("disabled")).toBe(false), { timeout: 2000 });
  fireEvent.click(next);
  fireEvent.click(screen.getByRole("button", { name: "Continue to Review" }));
  // Other parts repeat these words: Review's rows come last.
  const row = (term: string) =>
    form()
      .getAllByText(term)
      .filter((element) => element.tagName === "DT")
      .at(-1)?.nextElementSibling?.textContent;
  expect(row("Customer")).toContain("Mara Ilić · mara@example.com");
  expect(row("Items")).toContain("1 item · 100.00 USDC");
  expect(row("Client pays")).toContain("100.00 USDC on Base Sepolia");
  expect(row("You receive")).toContain("100.00 USDC");
  expect(form().getByText(/email to mara@example.com/)).toBeTruthy();
});

it("counts an item's price at once, and asks for its description on Continue", async () => {
  stubFetch(() => new Response("{}"));
  render(
    <Provider store={makeStore({ getAccessToken: async () => "token" })}>
      <NewInvoiceForm profileId={PROFILE} testnet tokens={[TOKEN]} />
    </Provider>,
  );
  fireEvent.change(screen.getByRole("textbox", { name: /^(Legal|Full) name$/ }), {
    target: { value: "Mara Ilić" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue to Items" }));
  expect(screen.queryByLabelText("Item 1")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Add item" }));
  fireEvent.change(screen.getByLabelText(/^Price/), { target: { value: "12" } });
  expect(form().getByText("Subtotal").nextElementSibling?.textContent).toBe("12.00 USDC");
  const next = screen.getByRole("button", { name: "Continue to Details" });
  await waitFor(() => expect(next.hasAttribute("disabled")).toBe(false), { timeout: 2000 });
  fireEvent.click(next);
  expect(document.querySelector('[aria-current="step"]')?.textContent).toContain("Items");
  expect(document.activeElement).toBe(screen.getByLabelText("Item 1"));
});

it("keeps More options open while a field it opened for is fixed", async () => {
  stubFetch(() => new Response("{}"));
  render(
    <Provider store={makeStore({ getAccessToken: async () => "token" })}>
      <NewInvoiceForm profileId={PROFILE} testnet tokens={[TOKEN]} />
    </Provider>,
  );
  fireEvent.change(screen.getByRole("textbox", { name: /^(Legal|Full) name$/ }), {
    target: { value: "Mara Ilić" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue to Items" }));
  fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "100" } });
  const toDetails = screen.getByRole("button", { name: "Continue to Details" });
  await waitFor(() => expect(toDetails.hasAttribute("disabled")).toBe(false), { timeout: 2000 });
  fireEvent.click(toDetails);
  const more = screen.getByRole("button", { name: "More options" });
  fireEvent.click(more);
  const link = screen.getByLabelText(/^Return link/) as HTMLInputElement;
  fireEvent.change(link, { target: { value: "http://x" } });
  fireEvent.click(more);
  expect(more.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Continue to Review" }));
  fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
  expect(more.getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(link);
  fireEvent.change(link, { target: { value: "https://x" } });
  expect(more.getAttribute("aria-expanded")).toBe("true");
  expect(link.closest("[inert]")).toBeNull();
});
