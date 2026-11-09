// @vitest-environment jsdom
import { ToastProvider } from "@forwend/ui-web";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, expect, it, vi } from "vitest";
import { LinkForm } from "@/features/links/components/link-form";
import type { Link } from "@/features/links/types/links";
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

const save = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Save link" }));
  await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
};

it("preserves an exact payment-link expiry when only its title changes", async () => {
  const bodies = edit(LINK);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "After" } });
  await save();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ title: "After", endsAt: LINK.endsAt });
});

it("saves a link that isn't reusable with a cap of one payment, and a reusable one with its own cap", async () => {
  const bodies = edit({ ...LINK, maxPayments: 25 });
  const reusable = screen.getByRole("switch", { name: "Reusable" });
  expect(reusable.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(reusable);
  // Off, the limit slides shut: still mounted for the motion, but inert.
  expect(screen.getByLabelText("Payment limit").closest("[inert]")).not.toBeNull();
  await save();
  fireEvent.click(reusable);
  await save();
  expect(bodies.map((body) => body.maxPayments)).toEqual([1, 25]);
});

it("saves a reusable link with an empty limit as no limit", async () => {
  const bodies = edit(LINK);
  expect(screen.getByLabelText("Payment limit")).toHaveProperty("value", "");
  await save();
  expect(bodies.map((body) => body.maxPayments)).toEqual([null]);
});

it("opens a one-payment link with Reusable off", () => {
  edit({ ...LINK, maxPayments: 1 });
  expect(screen.getByRole("switch", { name: "Reusable" }).getAttribute("aria-checked")).toBe(
    "false",
  );
});

// D-122: the link saves who pays its fees: the profile's choice to start, and the client once the switch is on.
it("saves who pays the network fee", async () => {
  const bodies = edit(LINK);
  await save();
  fireEvent.click(
    screen.getByRole("switch", { name: "Add the network fee to what your client pays" }),
  );
  await save();
  expect(bodies.map((body) => body.feesPaidBy)).toEqual(["owner", "client"]);
});
