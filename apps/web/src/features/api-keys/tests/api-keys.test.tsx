// @vitest-environment jsdom
import { ToastProvider } from "@forwend/ui-web";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, expect, it, vi } from "vitest";
import { ApiKeys } from "@/features/api-keys/components/api-keys";
import { makeStore } from "@/store/store";

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

it("New key: the secret shows once, is never in the store, and is gone after close", async () => {
  let keys: ReturnType<typeof key>[] = [];
  const { store, container } = mount(async (request) => {
    if (request.method === "POST") {
      const made = key(NEW, { last4: "Yx8Z" });
      keys = [made];
      return Response.json({ ...made, secret: SECRET }, { status: 201 });
    }
    return Response.json({ keys });
  });
  fireEvent.click(await screen.findByRole("button", { name: "New key" }));
  fireEvent.change(screen.getByRole("textbox", { hidden: true }), { target: { value: "CI" } });
  fireEvent.submit(
    screen
      .getByRole("button", { name: "Make key", hidden: true })
      .closest("form") as HTMLFormElement,
  );
  await waitFor(() => expect(secretDialog(container)?.hasAttribute("open")).toBe(true));
  expect(JSON.stringify(store.getState())).not.toContain(SECRET);
  secretDialog(container)?.close();
  await waitFor(() => expect(container.textContent).not.toContain(SECRET));
  expect(JSON.stringify(store.getState())).not.toContain(SECRET);
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
    const roll = await screen.findByRole("button", { name: "Roll key", hidden: true });
    act(() => roll.closest("dialog")?.showModal());
    fireEvent.submit(roll.closest("form") as HTMLFormElement);
    await waitFor(() => expect(container.textContent).toContain("Yx8Z"));
    expect(container.textContent?.includes("q7Rt")).toBe(keepsOld);
    expect(secretDialog(container)?.hasAttribute("open")).toBe(true);
    expect(JSON.stringify(store.getState())).not.toContain(SECRET);
    secretDialog(container)?.close();
    await waitFor(() => expect(container.textContent).not.toContain(SECRET));
  });
}
