// @vitest-environment jsdom
import { ToastProvider } from "@forwend/ui-web";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, expect, it, vi } from "vitest";
import { TeamMembers } from "@/features/team/components/team-members";
import { makeStore } from "@/store/store";

afterEach(cleanup);

it("a failed stores load shows Try again, which then loads the team", async () => {
  let storesUp = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) =>
      request.url.endsWith("/stores")
        ? storesUp
          ? Response.json({ stores: [] })
          : Response.json({}, { status: 500 })
        : Response.json({ members: [], invites: [] }),
    ),
  );
  render(
    <Provider store={makeStore({ getAccessToken: async () => "token" })}>
      <ToastProvider>
        <TeamMembers profileId="6f9619ff-8b86-4011-b42d-00c04fc964ff" />
      </ToastProvider>
    </Provider>,
  );
  const retry = await screen.findByRole("button", { name: "Try again" });
  storesUp = true;
  fireEvent.click(retry);
  await screen.findByRole("region", { name: "Members" });
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
});
