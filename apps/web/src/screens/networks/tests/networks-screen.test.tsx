// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, expect, it, vi } from "vitest";
import { NetworksScreen } from "@/screens/networks/networks-screen";
import { makeStore } from "@/store/store";

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

const NAME = { name: /Accept other tokens/ };
const toggle = () => screen.getByRole("switch", NAME);

it("saves only the switch when other tokens are turned off, so a token turned off elsewhere stays off", async () => {
  const puts: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      if (request.method !== "PUT") return Response.json({ tokens: [USDC], crossChain: true });
      const body = await request.json();
      puts.push(body);
      return Response.json({ tokens: [USDC], crossChain: body.crossChain });
    }),
  );
  render(
    <Provider store={makeStore({ getAccessToken: async () => "token" })}>
      <NetworksScreen />
    </Provider>,
  );
  fireEvent.click(await screen.findByRole("switch", NAME));
  await waitFor(() => expect(puts).toEqual([{ crossChain: false }]));
  await waitFor(() => expect(toggle().getAttribute("aria-checked")).toBe("false"));
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
  fireEvent.click(await screen.findByRole("switch", NAME));
  await screen.findByRole("alert");
  expect(toggle().getAttribute("aria-checked")).toBe("true");
});
