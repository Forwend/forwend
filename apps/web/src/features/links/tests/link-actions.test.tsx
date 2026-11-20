// @vitest-environment jsdom
import { ToastProvider } from "@forwend/ui-web";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, expect, it, vi } from "vitest";
import { LinkActions } from "@/features/links/components/link-actions";
import type { Link } from "@/features/links/types/links";
import { makeStore } from "@/store/store";

afterEach(cleanup);

const LINK: Link = {
  linkId: "aaaaaaaa-0000-4000-8000-000000000001",
  slug: "k3f9q2m7x1ab",
  livemode: false,
  title: "Logo design",
  storeId: null,
  amountUsd: "50.00",
  minUsd: null,
  maxUsd: null,
  endsAt: null,
  maxPayments: null,
  active: true,
  feesPaidBy: "client",
  visits: 0,
  paid: 0,
  createdAt: "2026-10-25T00:00:00Z",
  updatedAt: "2026-10-25T00:00:00Z",
};

it("turns a link off without changing who pays its fees", async () => {
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
        <LinkActions
          profileId="6f9619ff-8b86-4011-b42d-00c04fc964ff"
          link={LINK}
          refreshing={false}
        />
      </ToastProvider>
    </Provider>,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "More actions" }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Turn off" }));
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toMatchObject({ active: false, feesPaidBy: "client" });
});
