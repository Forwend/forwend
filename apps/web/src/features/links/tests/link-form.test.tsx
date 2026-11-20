// @vitest-environment jsdom
import { ToastProvider } from "@forwend/ui-web";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, expect, it, vi } from "vitest";
import { LinkForm } from "@/features/links/components/link-form";
import type { Link } from "@/features/links/types/links";
import { makeStore } from "@/store/store";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(cleanup);

const LINK: Link = {
  linkId: "aaaaaaaa-0000-4000-8000-000000000001",
  slug: "k3f9q2m7x1ab",
  livemode: false,
  title: "Before",
  storeId: null,
  amountUsd: "50.00",
  minUsd: null,
  maxUsd: null,
  endsAt: "2026-10-28T10:00:00Z",
  maxPayments: null,
  active: true,
  visits: 0,
  paid: 0,
  createdAt: "2026-10-25T00:00:00Z",
  updatedAt: "2026-10-25T00:00:00Z",
};

function edit(link: Link) {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      bodies.push(JSON.parse(await request.text()));
      return Response.json({}, { status: 500 });
    }),
  );
  render(
    <Provider store={makeStore({ getAccessToken: async () => "token" })}>
      <ToastProvider>
        <LinkForm profileId="6f9619ff-8b86-4011-b42d-00c04fc964ff" link={link} stores={[]} />
      </ToastProvider>
    </Provider>,
  );
  return bodies;
}

const save = async (bodies: unknown[]) => {
  const button = screen.getByRole("button", { name: "Save link" });
  const count = bodies.length + 1;
  fireEvent.click(button);
  await waitFor(() => expect(bodies).toHaveLength(count));
  await waitFor(() => expect(button.getAttribute("aria-busy")).toBeNull());
};

it("preserves an exact payment-link expiry when only its title changes", async () => {
  const bodies = edit(LINK);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "After" } });
  await save(bodies);
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ title: "After", endsAt: LINK.endsAt });
});

it("saves a link that isn't reusable with a cap of one payment, and a reusable one with its own cap", async () => {
  const bodies = edit({ ...LINK, maxPayments: 25 });
  const reusable = screen.getByRole("switch", { name: "Reusable" });
  expect(reusable.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(reusable);
  expect(screen.getByLabelText("Payment limit").closest("[inert]")).not.toBeNull();
  await save(bodies);
  fireEvent.click(reusable);
  await save(bodies);
  expect(bodies.map((body) => body.maxPayments)).toEqual([1, 25]);
});

it("saves a reusable link with an empty limit as no limit", async () => {
  const bodies = edit(LINK);
  expect(screen.getByLabelText("Payment limit")).toHaveProperty("value", "");
  await save(bodies);
  expect(bodies.map((body) => body.maxPayments)).toEqual([null]);
});

it("opens a one-payment link with Reusable off", () => {
  edit({ ...LINK, maxPayments: 1 });
  expect(screen.getByRole("switch", { name: "Reusable" }).getAttribute("aria-checked")).toBe(
    "false",
  );
});

it("saves who pays the network fee", async () => {
  const bodies = edit(LINK);
  await save(bodies);
  fireEvent.click(
    screen.getByRole("switch", { name: "Add the network fee to what your client pays" }),
  );
  await save(bodies);
  expect(bodies.map((body) => body.feesPaidBy)).toEqual(["owner", "client"]);
});

it("prices the fee with the link's store", async () => {
  const asked: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      asked.push(new URL(request.url));
      return Response.json({}, { status: 500 });
    }),
  );
  const store = (storeId: string, name: string) => ({
    storeId,
    name,
    defaultExpiresIn: 3600,
    allowedOrigins: [],
    brandColor: null,
    logoAt: null,
    tokensOff: [],
    updatedAt: "2026-09-02T00:00:00Z",
  });
  const second = "66666666-6666-4666-8666-666666666667";
  render(
    <Provider store={makeStore({ getAccessToken: async () => "token" })}>
      <ToastProvider>
        <LinkForm
          profileId="6f9619ff-8b86-4011-b42d-00c04fc964ff"
          link={{ ...LINK, storeId: second }}
          stores={[store("66666666-6666-4666-8666-666666666666", "First"), store(second, "Second")]}
        />
      </ToastProvider>
    </Provider>,
  );
  await waitFor(() => expect(asked.some((u) => u.pathname.endsWith("/fees"))).toBe(true), {
    timeout: 2000,
  });
  expect(asked.find((u) => u.pathname.endsWith("/fees"))?.searchParams.get("storeId")).toBe(second);
});
