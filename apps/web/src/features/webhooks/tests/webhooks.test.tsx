// @vitest-environment jsdom
import { ToastProvider } from "@forwend/ui-web";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
// jsdom lacks the modal methods.
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
const open = (name: string) => {
  const dialog = [...document.querySelectorAll("dialog")].find(
    (d) => d.querySelector("h2")?.textContent === name,
  );
  act(() => dialog?.showModal());
  return dialog as HTMLDialogElement;
};

const choose = async (item: string) => {
  const actions = await screen.findByRole("button", {
    name: /Actions for shop.example.com\/hooks/,
  });
  fireEvent.keyDown(actions, { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
};
const dialogWith = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll("dialog")].find((d) => d.textContent?.includes(text));

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
  const { container } = mount(() => undefined);
  await screen.findByText("shop.example.com/hooks");
  expect(container.textContent).not.toContain("receiver-secret");
});

it("New endpoint: refuses a non-https URL or no events, then saves under a new id", async () => {
  const { writes } = mount((call) =>
    call.method === "PUT"
      ? Response.json(endpoint(), { status: 201 })
      : Response.json({ endpoints: [] }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "New endpoint" }));
  const form = screen
    .getByRole("button", { name: "Save endpoint", hidden: true })
    .closest("form") as HTMLFormElement;
  const url = screen.getByRole("textbox", { name: /Endpoint URL/, hidden: true });
  fireEvent.change(url, { target: { value: "http://shop.example.com/hooks" } });
  for (const name of ["Paid", "Money in your wallet"]) {
    fireEvent.click(screen.getByRole("checkbox", { name, hidden: true }));
  }
  fireEvent.submit(form);
  expect(url.getAttribute("aria-invalid")).toBe("true");

  fireEvent.change(url, { target: { value: " https://shop.example.com/hooks " } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Money held for the payer", hidden: true }));
  fireEvent.submit(form);
  await waitFor(() => expect(writes()).toHaveLength(1));
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

it("Turn off sends the endpoint unchanged but for enabled", async () => {
  const { writes } = mount((call) =>
    call.method === "PUT" ? Response.json(endpoint({ enabled: false })) : undefined,
  );
  await choose("Turn off");
  await waitFor(() => expect(writes()).toHaveLength(1));
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
});

it("the signing secret shows only until its dialog closes and never enters the store", async () => {
  const { store, container } = mount((call) =>
    call.path.endsWith("/secret")
      ? Response.json({
          secrets: [{ secret: SECRET, createdAt: "2026-10-20T10:00:00Z", expiresAt: null }],
        })
      : undefined,
  );
  await choose("Signing secret");
  await waitFor(() => expect(dialogWith(container, SECRET)?.hasAttribute("open")).toBe(true));
  expect(JSON.stringify(store.getState())).not.toContain(SECRET);
  dialogWith(container, SECRET)?.close();
  await waitFor(() => expect(container.textContent).not.toContain(SECRET));
});

it("Rotate shows the new secret and the old one, and keeps both out of the store", async () => {
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
  await screen.findByText("shop.example.com/hooks");
  const rotate = open("Rotate the secret of shop.example.com/hooks?");
  fireEvent.click(screen.getByRole("button", { name: "Rotate secret", hidden: true }));
  await waitFor(() => expect(dialogWith(container, OLD_SECRET)?.hasAttribute("open")).toBe(true));
  expect(dialogWith(container, SECRET)).toBe(dialogWith(container, OLD_SECRET));
  expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual([
    `POST /v1/profiles/${PROFILE}/webhooks/${ID}/secret/rotate`,
  ]);
  expect(rotate.hasAttribute("open")).toBe(false);
  expect(JSON.stringify(store.getState())).not.toContain(OLD_SECRET);
});

it("Deliveries: resends one, sends a test event and resends the failed ones in the chosen window", async () => {
  const delivery = {
    eventId: `evt_${"a".repeat(32)}`,
    type: "invoice.paid",
    invoiceId: `0x${"ab".repeat(32)}`,
    number: 7,
    status: "failed",
    nextAttemptAt: null,
    createdAt: "2026-10-20T10:00:00Z",
    attempts: [{ at: "2026-10-20T10:00:00Z", statusCode: 500, error: null, durationMs: 41 }],
  };
  const { writes } = mount(
    (call) => {
      if (call.path.endsWith("/deliveries")) return Response.json({ deliveries: [delivery] });
      if (call.path.endsWith("/resend")) return new Response(null, { status: 204 });
      if (call.path.endsWith("/test"))
        return Response.json({ eventId: `evt_${"b".repeat(32)}` }, { status: 201 });
      if (call.path.endsWith("/resend-failed")) return Response.json({ resent: 2 });
    },
    <Deliveries profileId={PROFILE} endpoint={endpoint()} />,
  );
  fireEvent.click(await screen.findByRole("button", { name: /^Resend Paid INV-0007 from / }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Send test event" }));
  await waitFor(() => expect(writes()).toHaveLength(2));
  const before = Date.now();
  fireEvent.click(screen.getByRole("button", { name: "Resend failed" }));
  await waitFor(() => expect(writes()).toHaveLength(3));
  const base = `/v1/profiles/${PROFILE}/webhooks/${ID}`;
  const sent = writes();
  expect(sent.map((c) => `${c.method} ${c.path}`)).toEqual([
    `POST ${base}/deliveries/${delivery.eventId}/resend`,
    `POST ${base}/test`,
    `POST ${base}/deliveries/resend-failed`,
  ]);
  const since = Date.parse((sent[2]?.body as { since?: string } | undefined)?.since ?? "");
  expect(Math.abs(before - 72 * 3600_000 - since)).toBeLessThan(5_000);
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
  const editing = async () =>
    within(
      await waitFor(() => {
        const dialog = [...document.querySelectorAll("dialog")].find((d) => d.hasAttribute("open"));
        expect(dialog).toBeTruthy();
        return dialog as HTMLElement;
      }),
    );
  await choose("Turn off");
  await waitFor(() => expect(writes()).toHaveLength(1));
  await screen.findAllByText("Off");
  await choose("Edit");
  const form = await editing();
  expect(form.getByRole("switch", { name: "Send events" }).getAttribute("aria-checked")).toBe(
    "false",
  );
  const description = form.getByRole("textbox", { name: /Description/ });
  fireEvent.change(description, { target: { value: "Renamed" } });
  fireEvent.submit(description.closest("form") as HTMLFormElement);
  await waitFor(() => expect(writes()).toHaveLength(2));
  expect(writes().at(-1)?.body).toMatchObject({ description: "Renamed", enabled: false });
  await screen.findByText("Renamed");
  await choose("Edit");
  expect(
    ((await editing()).getByRole("textbox", { name: /Description/ }) as HTMLInputElement).value,
  ).toBe("Renamed");
});

it("a merchant's New endpoint saves for all stores, naming no store", async () => {
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
  fireEvent.click(await screen.findByRole("button", { name: "New endpoint" }));
  const url = screen.getByRole("textbox", { name: /Endpoint URL/, hidden: true });
  fireEvent.change(url, { target: { value: "https://shop.example.com/hooks" } });
  fireEvent.submit(url.closest("form") as HTMLFormElement);
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(writes()[0]?.body).not.toHaveProperty("storeId");
});
