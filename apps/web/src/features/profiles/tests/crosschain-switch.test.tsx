// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, expect, it, vi } from "vitest";
import { CrossChainSwitch } from "@/features/profiles/components/crosschain-switch";
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
  chainId: 8453,
  token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  symbol: "USDC",
  decimals: 6,
  network: "base",
  on: true,
};
const OUSD = {
  ...USDC,
  chainId: 4217,
  token: "0x20c0000000000000000000006a37da5c996874be",
  symbol: "OUSD",
  on: false,
};

afterEach(cleanup);

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));

// R-240: the switch saves with the tokens the profile has off, so the token switches never change with it.
it("turns payments from other chains off and keeps the tokens off as they were", async () => {
  const puts: unknown[] = [];
  let crossChain = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      if (request.method === "PUT") {
        const body = await request.json();
        puts.push(body);
        crossChain = body.crossChain;
      }
      return Response.json({ tokens: [USDC, OUSD], crossChain });
    }),
  );
  render(
    <Provider store={makeStore({ getAccessToken: async () => "token" })}>
      <CrossChainSwitch profileId="p" saved={[USDC, OUSD]} />
    </Provider>,
  );
  await settle();
  const toggle = () =>
    screen.getByRole("switch", { name: /Accept other tokens through NEAR Intents/ });
  expect(toggle().getAttribute("aria-checked")).toBe("true");
  act(() => toggle().click());
  await settle();
  expect(puts).toEqual([
    { off: [{ chainId: OUSD.chainId, token: OUSD.token }], crossChain: false },
  ]);
  expect(toggle().getAttribute("aria-checked")).toBe("false");
});
