// @vitest-environment jsdom
import { ToastProvider } from "@forwend/ui-web";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { afterEach, expect, it, vi } from "vitest";
import { Deliveries } from "@/features/webhooks/components/deliveries";
import { Webhooks } from "@/features/webhooks/components/webhooks";
import type { WebhookEndpoint } from "@/features/webhooks/types/webhooks";
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
// jsdom lacks the modal methods; this is what the browser does that matters here.
const proto = HTMLDialogElement.prototype as HTMLDialogElement & Record<string, unknown>;
if (typeof proto.showModal !== "function") {
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

const PROFILE = "6f9619ff-8b86-4011-b42d-00c04fc964ff";
const ID = "cccccccc-0000-4000-8000-000000000001";
const SECRET = `whsec_${"A".repeat(43)}=`;
const OLD_SECRET = `whsec_${"B".repeat(43)}=`;
const endpoint = (fields: Partial<WebhookEndpoint> = {}): WebhookEndpoint => ({
  endpointId: ID,
  url: "https://shop.example.com/hooks?token=receiver-secret",
  description: "Orders",
  storeId: null,
  events: ["invoice.paid", "invoice.settled"],
  enabled: true,
  livemode: false,
  createdAt: "2026-10-20T10:00:00Z",
  updatedAt: "2026-10-20T10:00:00Z",
  ...fields,
});
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));
const open = (name: string) => {
  const dialog = [...document.querySelectorAll("dialog")].find(
    (d) => d.querySelector("h2")?.textContent === name,
  );
  act(() => dialog?.showModal());
  return dialog as HTMLDialogElement;
};

const choose = async (item: string) => {
  fireEvent.keyDown(screen.getByRole("button", { name: /Actions for shop.example.com\/hooks/ }), {
    key: "Enter",
  });
  await settle();
  fireEvent.click(screen.getByRole("menuitem", { name: item }));
  await settle();
};

afterEach(cleanup);

type Call = { method: string; path: string; body: unknown };

function mount(answer: (call: Call) => Response | undefined, ui?: ReactNode) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      const text = await request.text();
      const call = {
        method: request.method,
        path: new URL(request.url).pathname.replace(/^\/api/, ""), // the app's same-origin proxy
        body: text ? JSON.parse(text) : undefined,
      };
      calls.push(call);
      return answer(call) ?? Response.json({ endpoints: [endpoint()] });
    }),
  );
  const store = makeStore({ getAccessToken: async () => "token" });
  const view = render(
    <Provider store={store}>
      <ToastProvider>{ui ?? <Webhooks profileId={PROFILE} merchant={false} />}</ToastProvider>
    </Provider>,
  );
  return { store, calls, writes: () => calls.filter((c) => c.method !== "GET"), ...view };
}

it("lists each endpoint by its host and path, never the query that may hold a token", async () => {
  const { container } = mount(() => Response.json({ endpoints: [endpoint({ enabled: false })] }));
  await settle();
  expect(container.textContent).toContain("shop.example.com/hooks");
  expect(container.textContent).not.toContain("receiver-secret");
  expect(container.textContent).toContain("Off");
  expect(container.textContent).toContain("Test mode");
  expect(container.textContent).toContain("Paid, Money in your wallet");
});

it("New endpoint: checks the URL and events, then saves under a new id", async () => {
  const { writes } = mount((call) =>
    call.method === "PUT"
      ? Response.json(endpoint(), { status: 201 })
      : Response.json({ endpoints: [] }),
  );
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "New endpoint" }));
  const form = screen
    .getByRole("button", { name: "Save endpoint", hidden: true })
    .closest("form") as HTMLFormElement;
  const url = screen.getByRole("textbox", { name: /Endpoint URL/, hidden: true });
  fireEvent.change(url, { target: { value: "http://shop.example.com/hooks" } });
  for (const name of ["Paid", "Money in your wallet"]) {
    fireEvent.click(screen.getByRole("checkbox", { name, hidden: true }));
  }
  fireEvent.submit(form);
  await settle();
  expect(form.textContent).toContain("Enter an https address");
  expect(form.textContent).toContain("Pick at least one.");
  expect(writes()).toEqual([]);

  fireEvent.change(url, { target: { value: " https://shop.example.com/hooks " } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Money held for the payer", hidden: true }));
  fireEvent.submit(form);
  await settle();
  const [put] = writes();
  expect(put?.method).toBe("PUT");
  expect(put?.path).toMatch(new RegExp(`^/v1/profiles/${PROFILE}/webhooks/[0-9a-f-]{36}$`));
  expect(put?.body).toEqual({
    url: "https://shop.example.com/hooks",
    description: "",
    events: ["invoice.held"],
    enabled: true,
  });
});

it("the menu turns an endpoint off with the rest of it unchanged, and reveals the secret only until closed", async () => {
  const { store, writes, container } = mount((call) => {
    if (call.method === "PUT") return Response.json(endpoint({ enabled: false }));
    if (call.path.endsWith("/secret"))
      return Response.json({
        secrets: [{ secret: SECRET, createdAt: "2026-10-20T10:00:00Z", expiresAt: null }],
      });
  });
  await settle();
  await choose("Turn off");
  expect(writes()).toEqual([
    {
      method: "PUT",
      path: `/v1/profiles/${PROFILE}/webhooks/${ID}`,
      body: {
        url: "https://shop.example.com/hooks?token=receiver-secret",
        description: "Orders",
        events: ["invoice.paid", "invoice.settled"],
        enabled: false,
      },
    },
  ]);
  await choose("Signing secret");
  const dialog = [...container.querySelectorAll("dialog")].find((d) =>
    d.textContent?.includes(SECRET),
  );
  expect(dialog?.hasAttribute("open")).toBe(true);
  expect(JSON.stringify(store.getState())).not.toContain(SECRET);
  dialog?.close();
  await settle();
  expect(container.textContent).not.toContain(SECRET);
});

it("Rotate shows the new secret and the old one with when it stops", async () => {
  const { store, writes, container } = mount((call) => {
    if (call.path.endsWith("/rotate"))
      return Response.json(
        {
          secrets: [
            { secret: SECRET, createdAt: "2026-10-21T10:00:00Z", expiresAt: null },
            {
              secret: OLD_SECRET,
              createdAt: "2026-10-20T10:00:00Z",
              expiresAt: "2026-10-22T10:00:00Z",
            },
          ],
        },
        { status: 201 },
      );
  });
  await settle();
  const rotate = open("Rotate the secret of shop.example.com/hooks?");
  fireEvent.click(screen.getByRole("button", { name: "Rotate secret", hidden: true }));
  await settle();
  expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual([
    `POST /v1/profiles/${PROFILE}/webhooks/${ID}/secret/rotate`,
  ]);
  expect(rotate.hasAttribute("open")).toBe(false);
  const shown = [...container.querySelectorAll("dialog")].find((d) =>
    d.textContent?.includes(OLD_SECRET),
  );
  expect(shown?.hasAttribute("open")).toBe(true);
  expect(shown?.textContent).toContain("Also signs until");
  expect(JSON.stringify(store.getState())).not.toContain(OLD_SECRET);
});

it("Delete asks first, then deletes", async () => {
  const { writes } = mount((call) =>
    call.method === "DELETE" ? new Response(null, { status: 204 }) : undefined,
  );
  await settle();
  await choose("Delete");
  const confirm = [...document.querySelectorAll("dialog")].find(
    (d) => d.querySelector("h2")?.textContent === "Delete shop.example.com/hooks?",
  ) as HTMLDialogElement;
  expect(confirm.hasAttribute("open")).toBe(true);
  expect(writes()).toEqual([]);
  fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
  await settle();
  expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual([
    `DELETE /v1/profiles/${PROFILE}/webhooks/${ID}`,
  ]);
});

it("Deliveries: each attempt, a resend, a test event and a resend of the failed ones in a window", async () => {
  const delivery = {
    eventId: `evt_${"a".repeat(32)}`,
    type: "invoice.paid",
    invoiceId: `0x${"ab".repeat(32)}`,
    number: 7,
    status: "failed",
    nextAttemptAt: null,
    createdAt: "2026-10-20T10:00:00Z",
    attempts: [
      { at: "2026-10-20T10:00:00Z", statusCode: 500, error: null, durationMs: 41 },
      { at: "2026-10-20T10:00:05Z", statusCode: null, error: "address not public", durationMs: 2 },
    ],
  };
  const { writes, container } = mount(
    (call) => {
      if (call.path.endsWith("/deliveries")) return Response.json({ deliveries: [delivery] });
      if (call.path.endsWith("/resend")) return new Response(null, { status: 204 });
      if (call.path.endsWith("/test"))
        return Response.json({ eventId: `evt_${"b".repeat(32)}` }, { status: 201 });
      if (call.path.endsWith("/resend-failed")) return Response.json({ resent: 2 });
    },
    <Deliveries profileId={PROFILE} endpoint={endpoint({ enabled: false })} />,
  );
  await settle();
  for (const text of [
    "Paid",
    "INV-0007",
    "Failed",
    "2 attempts",
    "500",
    "No answer",
    "address not public",
    "41 ms",
  ]) {
    expect(container.textContent).toContain(text);
  }
  expect(container.textContent).toContain("This endpoint is off");
  fireEvent.click(screen.getByRole("button", { name: /^Resend Paid INV-0007 from / }));
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Send test event" }));
  await settle();
  const before = Date.now();
  fireEvent.click(screen.getByRole("button", { name: "Resend failed" }));
  await settle();
  const base = `/v1/profiles/${PROFILE}/webhooks/${ID}`;
  const sent = writes();
  expect(sent.map((c) => `${c.method} ${c.path}`)).toEqual([
    `POST ${base}/deliveries/${delivery.eventId}/resend`,
    `POST ${base}/test`,
    `POST ${base}/deliveries/resend-failed`,
  ]);
  const since = Date.parse((sent[2]?.body as { since?: string } | undefined)?.since ?? "");
  expect(Math.abs(before - 72 * 3600_000 - since)).toBeLessThan(5_000);
  expect(container.textContent).toContain("2 deliveries sent again");
});

it("Edit opens with the endpoint as it is now: after Turn off and a rename it shows those, and saves them", async () => {
  let current = endpoint();
  const { writes } = mount((call) => {
    if (call.method === "PUT") {
      current = endpoint(call.body as Partial<WebhookEndpoint>);
      return Response.json(current);
    }
    return Response.json({ endpoints: [current] });
  });
  await settle();
  const editing = () =>
    within(
      [...document.querySelectorAll("dialog")].find((d) => d.hasAttribute("open")) as HTMLElement,
    );
  await choose("Turn off");
  await choose("Edit");
  expect(editing().getByRole("switch", { name: "Send events" }).getAttribute("aria-checked")).toBe(
    "false",
  );
  const description = editing().getByRole("textbox", { name: /Description/ });
  fireEvent.change(description, { target: { value: "Renamed" } });
  fireEvent.submit(description.closest("form") as HTMLFormElement);
  await settle();
  expect(writes().at(-1)?.body).toMatchObject({ description: "Renamed", enabled: false });
  await choose("Edit");
  expect((editing().getByRole("textbox", { name: /Description/ }) as HTMLInputElement).value).toBe(
    "Renamed",
  );
});

it("a merchant's failed stores load shows Try again, which then loads the endpoints", async () => {
  let storesUp = false;
  const { container } = mount(
    (call) =>
      call.path.endsWith("/stores")
        ? storesUp
          ? Response.json({ stores: [] })
          : Response.json({}, { status: 500 })
        : undefined,
    <Webhooks profileId={PROFILE} merchant />,
  );
  await settle();
  expect(screen.getByRole("alert").textContent).toContain("could not load");
  storesUp = true;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await settle();
  expect(container.textContent).toContain("shop.example.com/hooks");
});

it("a merchant's New endpoint starts on All stores, shown as such, and saves without a store", async () => {
  const { writes } = mount(
    (call) => {
      if (call.path.endsWith("/stores"))
        return Response.json({
          stores: [
            {
              storeId: "66666666-6666-4666-8666-666666666666",
              name: "Sample shop",
              defaultExpiresIn: 3600,
              allowedOrigins: [],
              brandColor: null,
              logoAt: null,
              tokensOff: [],
              updatedAt: "2026-09-02T00:00:00Z",
            },
          ],
        });
      if (call.method === "PUT") return Response.json(endpoint(), { status: 201 });
      return Response.json({ endpoints: [] });
    },
    <Webhooks profileId={PROFILE} merchant />,
  );
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "New endpoint" }));
  expect(screen.getByRole("combobox", { name: "Store", hidden: true }).textContent).toBe(
    "All stores",
  );
  const url = screen.getByRole("textbox", { name: /Endpoint URL/, hidden: true });
  fireEvent.change(url, { target: { value: "https://shop.example.com/hooks" } });
  fireEvent.submit(url.closest("form") as HTMLFormElement);
  await settle();
  expect(writes().at(-1)?.body).not.toHaveProperty("storeId");
});
