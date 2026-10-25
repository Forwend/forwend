// @vitest-environment jsdom
import { ToastProvider } from "@forwend/ui-web";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, expect, it, vi } from "vitest";
import { ApiKeys } from "@/features/api-keys/components/api-keys";
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
const OLD = "aaaaaaaa-0000-4000-8000-000000000001";
const NEW = "aaaaaaaa-0000-4000-8000-000000000002";
const SECRET = `fw_test_${"A1b2C3d4E5".repeat(3)}Zz9Yx8`;
const key = (keyId: string, fields: object = {}) => ({
  keyId,
  name: "Production server",
  storeId: null,
  livemode: false,
  last4: "q7Rt",
  scopes: ["invoices.read"],
  createdAt: "2026-10-20T10:00:00Z",
  lastUsedAt: null,
  expiresAt: null as string | null,
  ...fields,
});
// R-144: a key's text is in one answer only; it shows once and never stays in the store.
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));
const secretDialog = (container: HTMLElement) =>
  [...container.querySelectorAll("dialog")].find((d) => d.textContent?.includes(SECRET));

afterEach(cleanup);

function mount(fetch: (request: Request) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(fetch));
  const store = makeStore({ getAccessToken: async () => "token" });
  const view = render(
    <Provider store={store}>
      <ToastProvider>
        <ApiKeys profileId={PROFILE} merchant={false} />
      </ToastProvider>
    </Provider>,
  );
  return { store, ...view };
}

it("New key: the secret shows with Copy focused, is never in the store, and is gone after close", async () => {
  let keys: ReturnType<typeof key>[] = [];
  const { store, container } = mount(async (request) => {
    if (request.method === "POST") {
      const made = key(NEW, { last4: "Yx8Z" });
      keys = [made];
      return Response.json({ ...made, secret: SECRET }, { status: 201 });
    }
    return Response.json({ keys });
  });
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "New key" }));
  const newDialog = screen
    .getByRole("button", { name: "Make key", hidden: true })
    .closest("dialog");
  expect(newDialog?.hasAttribute("open")).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { hidden: true }), { target: { value: "CI" } });
  fireEvent.submit(
    screen
      .getByRole("button", { name: "Make key", hidden: true })
      .closest("form") as HTMLFormElement,
  );
  await settle();
  const dialog = secretDialog(container);
  expect(dialog?.hasAttribute("open")).toBe(true);
  expect((document.activeElement as HTMLElement | null)?.textContent).toContain("Copy");
  expect(JSON.stringify(store.getState())).not.toContain(SECRET);
  dialog?.close();
  await settle();
  expect(container.textContent).not.toContain(SECRET);
  expect(JSON.stringify(store.getState())).not.toContain(SECRET);
  expect(container.textContent).toContain("Yx8Z");
});

for (const [overlap, keepsOld] of [
  ["24 hours (old key still listed)", true],
  ["0 hours (old key leaves the list)", false],
] as const) {
  it(`Roll with ${overlap}: the new secret shows after the refetch and is not in the store`, async () => {
    let keys = [key(OLD)];
    const { store, container } = mount(async (request) => {
      if (request.method === "POST" && request.url.endsWith("/roll")) {
        const made = key(NEW, { last4: "Yx8Z" });
        keys = keepsOld ? [made, key(OLD, { expiresAt: "2026-10-26T10:00:00Z" })] : [made];
        return Response.json({ ...made, secret: SECRET }, { status: 201 });
      }
      return Response.json({ keys });
    });
    await settle();
    const roll = screen.getByRole("button", { name: "Roll key", hidden: true });
    act(() => roll.closest("dialog")?.showModal());
    fireEvent.submit(roll.closest("form") as HTMLFormElement);
    await settle();
    expect(container.textContent?.includes("q7Rt")).toBe(keepsOld);
    expect(secretDialog(container)?.hasAttribute("open")).toBe(true);
    expect(JSON.stringify(store.getState())).not.toContain(SECRET);
    secretDialog(container)?.close();
    await settle();
    expect(container.textContent).not.toContain(SECRET);
  });
}

it("a merchant's failed stores load shows Try again, which then loads the keys", async () => {
  let storesUp = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) =>
      request.url.endsWith("/stores")
        ? storesUp
          ? Response.json({ stores: [] })
          : Response.json({}, { status: 500 })
        : Response.json({ keys: [key(OLD)] }),
    ),
  );
  const { container } = render(
    <Provider store={makeStore({ getAccessToken: async () => "token" })}>
      <ToastProvider>
        <ApiKeys profileId={PROFILE} merchant />
      </ToastProvider>
    </Provider>,
  );
  await settle();
  expect(screen.getByRole("alert").textContent).toContain("could not load");
  storesUp = true;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await settle();
  expect(container.textContent).toContain("Production server");
});
