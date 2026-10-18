// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewInvoiceForm } from "@/features/invoices/components/new-invoice-form";
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

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));

describe("new invoice form", () => {
  it("retries with the same Idempotency-Key after a network error when the checkout closes at a custom time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T10:00:00Z"));
    const keys: (string | null)[] = [];
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        keys.push(request.headers.get("Idempotency-Key"));
        bodies.push(await request.text());
        throw new TypeError("Failed to fetch");
      }),
    );
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <NewInvoiceForm profileId={PROFILE} tokens={[TOKEN]} />
      </Provider>,
    );
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "100" } });
    fireEvent.click(screen.getByLabelText("Custom"));
    fireEvent.click(screen.getByRole("button", { name: /Closes on/ }));
    // Three days from now, at the default 17:00.
    const days = within(screen.getByRole("grid"))
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-disabled") !== "true");
    fireEvent.click(days[3] as HTMLElement);

    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    await settle();
    expect(screen.getByText("We could not create the invoice. Try again.")).toBeTruthy();

    vi.setSystemTime(new Date("2026-10-14T10:00:02Z"));
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    await settle();

    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(bodies[1]).toBe(bodies[0]);
  });

  // R-86: an invoice keeps a copy of the saved client's details, sent in its create request.
  it("fills the client from a saved client and sends its details", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
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
        <NewInvoiceForm profileId={PROFILE} tokens={[TOKEN]} clients={[client]} />
      </Provider>,
    );
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: /^Saved client/ }));
    // The search box filters the list as it is typed, ignoring letter case.
    fireEvent.change(screen.getByRole("combobox", { name: /Saved client/ }), {
      target: { value: "bob" },
    });
    fireEvent.click(await screen.findByRole("option", { name: /^Bob Ltd/ }));
    expect((screen.getByLabelText("Tax or VAT ID") as HTMLInputElement).value).toBe("DE999999999");
    // R-90: the client's default PO number fills the invoice's reference.
    expect((screen.getByLabelText(/^PO or reference/) as HTMLInputElement).value).toBe(
      "PO-4500012345",
    );

    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    await settle();
    expect(bodies[0]?.client).toEqual({
      name: "Bob Ltd",
      email: "ap@bob.example",
      address: "Main St 1\nBerlin",
      country: "DE",
      taxId: "DE999999999",
    });
    expect(bodies[0]?.reference).toBe("PO-4500012345");
  });

  // R-88: items replace the amount field, their total becomes the amount, and a line the token can't hold is named.
  it("sends items whose total is the amount, unit prices in the amount's own unit", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
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
          <NewInvoiceForm profileId={PROFILE} tokens={tokens} />
        </Provider>,
      );
      fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "100" } });
      // The amount typed so far becomes the first item's price.
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
    expect(screen.getByText("750.50 USDC")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    await settle();
    expect(bodies[0]).toMatchObject({
      amount: "750500000",
      lines: [
        { description: "Design", quantity: "7.5", unitPrice: "100000000" },
        { description: "Hosting", quantity: "1", unitPrice: "500000" },
      ],
    });

    // Half a millionth of a dollar is no amount USDC can hold: named on the line, nothing sent.
    fireEvent.change(screen.getAllByLabelText("Qty")[1] as HTMLElement, {
      target: { value: "0.5" },
    });
    fireEvent.change(screen.getAllByLabelText(/^Price/)[1] as HTMLElement, {
      target: { value: "0.000001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    await settle();
    expect(screen.getByText("Qty × price needs more decimals than USDC has.")).toBeTruthy();
    expect(bodies).toHaveLength(1);
    cleanup();

    // Client chooses: the amount and unit prices are USD.
    fill([TOKEN, other]);
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    await settle();
    expect(bodies[1]).toMatchObject({
      amountUsd: "750.5",
      lines: [
        { description: "Design", quantity: "7.5", unitPrice: "100" },
        { description: "Hosting", quantity: "1", unitPrice: "0.5" },
      ],
    });
    expect(bodies[1]).not.toHaveProperty("amount");
  });

  it("shows each item's amount and the total exactly, not cut to cents", () => {
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <NewInvoiceForm profileId={PROFILE} tokens={[TOKEN]} />
      </Provider>,
    );
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "12.345" } });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    fireEvent.change(screen.getByLabelText("Item 1"), { target: { value: "Design" } });
    expect(screen.getByText("Total").parentElement?.textContent).toBe("Total12.345 USDC");
    expect(screen.queryByText("12.34 USDC")).toBeNull();
  });

  // The amount field is gone while items stand in for it, so the API's word on the amount shows under the items.
  it("shows a refused amount under the items", async () => {
    vi.stubGlobal(
      "fetch",
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
        <NewInvoiceForm profileId={PROFILE} tokens={[TOKEN]} />
      </Provider>,
    );
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    fireEvent.change(screen.getByLabelText("Item 1"), { target: { value: "Design" } });
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    await settle();
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toContain(
      "Enter an amount above 0 that every accepted token can hold.",
    );
  });

  // Adding or removing an item takes away the button that had focus, so focus moves to where the work goes on.
  it("keeps keyboard focus on the items as they are added and removed", () => {
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <NewInvoiceForm profileId={PROFILE} tokens={[TOKEN]} />
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Item 1"));
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Item 2"));
    fireEvent.click(screen.getByRole("button", { name: "Remove item 1" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Item 1"));
    fireEvent.click(screen.getByRole("button", { name: "Remove item 1" }));
    expect(document.activeElement).toBe(screen.getByLabelText(/Amount/));
  });

  // R-90: the reference follows the picked client's default, but never replaces one the owner typed.
  it("fills the reference from the picked client without losing a typed one", async () => {
    const saved = (clientId: string, name: string, reference: string | null) => ({
      clientId,
      name,
      email: null,
      address: null,
      country: null,
      taxId: null,
      reference,
      reminders: false,
      updatedAt: "2026-10-16T10:00:00Z",
    });
    const acme = saved("11111111-1111-4111-8111-111111111111", "Acme GmbH", "PO-ACME-1");
    const bob = saved("22222222-2222-4222-8222-222222222222", "Bob Ltd", null);
    Element.prototype.scrollIntoView = vi.fn();
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <NewInvoiceForm profileId={PROFILE} tokens={[TOKEN]} clients={[acme, bob]} />
      </Provider>,
    );
    const reference = () => (screen.getByLabelText(/^PO or reference/) as HTMLInputElement).value;
    const pick = async (name: string) => {
      fireEvent.click(screen.getByRole("button", { name: /^Saved client/ }));
      fireEvent.click(await screen.findByRole("option", { name: new RegExp(`^${name}`) }));
    };
    await pick("Acme GmbH");
    expect(reference()).toBe("PO-ACME-1");
    await pick("Bob Ltd");
    expect(reference()).toBe("");

    fireEvent.change(screen.getByLabelText(/^PO or reference/), { target: { value: "PO-777" } });
    await pick("Acme GmbH");
    expect(reference()).toBe("PO-777");
  });

  // R-91: a duplicate's form shows the earlier invoice's items without taking focus, and sends what it shows.
  it("fills from another invoice without moving focus", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        bodies.push(JSON.parse(await request.text()));
        throw new TypeError("Failed to fetch");
      }),
    );
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <NewInvoiceForm
          profileId={PROFILE}
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
    await settle();
    expect(document.activeElement).toBe(document.body);
    expect((screen.getByLabelText("Item 2") as HTMLInputElement).value).toBe("Hosting");
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    await settle();
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
    });
  });

  // R-93: the price agreed in fiat, checked in its currency's decimals before it is sent.
  it("adds an agreed value and names what is missing", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        bodies.push(JSON.parse(await request.text()));
        throw new TypeError("Failed to fetch");
      }),
    );
    Element.prototype.scrollIntoView = vi.fn();
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <NewInvoiceForm profileId={PROFILE} tokens={[TOKEN]} />
      </Provider>,
    );
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Add agreed value" }));
    // The button went away, so focus moved to what it asks for first.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Agreed in/ }));
    const create = () => fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    create();
    await settle();
    expect(screen.getByText("Choose a currency.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Agreed in/ }));
    fireEvent.change(screen.getByRole("combobox", { name: /Agreed in/ }), {
      target: { value: "yen" },
    });
    fireEvent.click(await screen.findByRole("option", { name: /^JPY/ }));
    fireEvent.change(screen.getByLabelText("Agreed amount"), { target: { value: "1.5" } });
    create();
    await settle();
    expect(screen.getByText("Enter a whole amount above 0.")).toBeTruthy();
    expect(bodies).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Agreed amount"), { target: { value: "15000" } });
    create();
    await settle();
    expect(bodies[0]?.agreedValue).toMatchObject({
      currency: "JPY",
      amount: "15000",
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });
});
