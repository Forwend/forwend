// @vitest-environment jsdom
import { ToastProvider } from "@forwend/ui-web";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, expect, it, vi } from "vitest";
import { TeamMembers } from "@/features/team/components/team-members";
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
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

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
  await settle();
  expect(screen.getByRole("alert").textContent).toContain("could not load the team");
  storesUp = true;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await settle();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("region", { name: "Members" })).toBeTruthy();
});
