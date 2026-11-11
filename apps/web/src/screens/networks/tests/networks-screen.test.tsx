// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, expect, it, vi } from "vitest";
import { NetworksScreen } from "@/screens/networks/networks-screen";
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

const PROFILE_ID = "6f1c2a4e-8b3d-4f5a-9c7e-1d2b3a4c5e6f";
vi.mock("@/features/profiles/hooks/use-app-session", () => ({
  useAppSession: () => ({ profile: { profileId: PROFILE_ID } }),
}));

const USDC = {
  chainId: 8453,
  token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  symbol: "USDC",
  decimals: 6,
  network: "base",
  on: true,
};

afterEach(cleanup);

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));
const NAME = { name: /Accept other tokens/ };
const toggle = () => screen.getByRole("switch", NAME);

// R-240: the switch saves alone, so a token turned off elsewhere is never put back by it.
it("shows the NEAR Intents switch on, and turning it off moves at once and saves only the switch", async () => {
  const puts: unknown[] = [];
  let answer: (() => void) | null = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      if (request.method !== "PUT") return Response.json({ tokens: [USDC], crossChain: true });
      const body = await request.json();
      puts.push(body);
      await new Promise<void>((resolve) => {
        answer = resolve;
      });
      return Response.json({ tokens: [USDC], crossChain: body.crossChain });
    }),
  );
  render(
    <Provider store={makeStore({ getAccessToken: async () => "token" })}>
      <NetworksScreen />
    </Provider>,
  );
  expect((await screen.findByRole("switch", NAME)).getAttribute("aria-checked")).toBe("true");
  act(() => toggle().click());
  await settle();
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  expect(screen.getByText("Saving…")).toBeTruthy();
  act(() => answer?.());
  await settle();
  expect(puts).toEqual([{ crossChain: false }]);
  expect(toggle().getAttribute("aria-checked")).toBe("false");
});

it("puts the switch back when the save is refused", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) =>
      request.method === "PUT"
        ? Response.json({ error: { code: "forbidden", message: "No" } }, { status: 403 })
        : Response.json({ tokens: [USDC], crossChain: true }),
    ),
  );
  render(
    <Provider store={makeStore({ getAccessToken: async () => "token" })}>
      <NetworksScreen />
    </Provider>,
  );
  await screen.findByRole("switch", NAME);
  act(() => toggle().click());
  await settle();
  expect(toggle().getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("alert")).toBeTruthy();
});
