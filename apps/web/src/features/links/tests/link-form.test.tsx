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

it("preserves an exact payment-link expiry when only its title changes", async () => {
  const link: Link = {
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
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "After" } });
  fireEvent.click(screen.getByRole("button", { name: "Save link" }));
  await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ title: "After", endsAt: link.endsAt });
});
