// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, expect, it, vi } from "vitest";
import { useGetProfileTokensQuery } from "@/features/profiles/api/profiles-api";
import { TokenSwitches } from "@/features/profiles/components/token-switches";
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

const USDC = {
  chainId: 84532,
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  symbol: "USDC",
  decimals: 6,
  network: "base-sepolia",
  on: true,
};
const OUSD = {
  chainId: 42431,
  token: "0x20c0000000000000000000006a37da5c996874be",
  symbol: "OUSD",
  decimals: 6,
  network: "tempo-moderato",
  on: false,
};

afterEach(cleanup);

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));

function Page() {
  const tokens = useGetProfileTokensQuery("p");
  return tokens.data ? <TokenSwitches profileId="p" saved={tokens.data} /> : null;
}

function serve(answer: () => Promise<Response>) {
  let tokens = [USDC, OUSD];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      if (request.method !== "PUT") return Response.json({ tokens });
      const response = await answer();
      if (response.ok) tokens = (await response.clone().json()).tokens;
      return response;
    }),
  );
}

// R-136
it("checks a box the moment it is pressed, and keeps every box usable while it saves", async () => {
  let release = () => {};
  serve(
    () =>
      new Promise((resolve) => {
        release = () => resolve(Response.json({ tokens: [USDC, { ...OUSD, on: true }] }));
      }),
  );
  render(
    <Provider store={makeStore({ getAccessToken: async () => "token" })}>
      <Page />
    </Provider>,
  );
  await settle();
  const ousd = () => screen.getByRole("checkbox", { name: "OUSD on every network" });
  act(() => ousd().click());
  await settle();
  // The save is still on its way.
  expect((ousd() as HTMLInputElement).checked).toBe(true);
  expect(
    (screen.getByRole("checkbox", { name: "USDC on every network" }) as HTMLInputElement).disabled,
  ).toBe(false);
  release();
  await settle();
  expect((ousd() as HTMLInputElement).checked).toBe(true);
});

it("puts the boxes back when the save is refused", async () => {
  serve(async () => Response.json({ error: { code: "invalid_request" } }, { status: 400 }));
  render(
    <Provider store={makeStore({ getAccessToken: async () => "token" })}>
      <Page />
    </Provider>,
  );
  await settle();
  const ousd = () => screen.getByRole("checkbox", { name: "OUSD on every network" });
  act(() => ousd().click());
  await settle();
  expect((ousd() as HTMLInputElement).checked).toBe(false);
});
