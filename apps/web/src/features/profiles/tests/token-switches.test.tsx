// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, expect, it, vi } from "vitest";
import { useGetProfileTokensQuery } from "@/features/profiles/api/profiles-api";
import { TokenSwitches } from "@/features/profiles/components/token-switches";
import { makeStore } from "@/store/store";

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

function Page() {
  const tokens = useGetProfileTokensQuery("p");
  return tokens.data ? <TokenSwitches profileId="p" saved={tokens.data} /> : null;
}

function serve(answer: () => Promise<Response>) {
  let tokens = [USDC, OUSD];
  const save = { sent: false };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      if (request.method !== "PUT") return Response.json({ tokens });
      save.sent = true;
      const response = await answer();
      if (response.ok) tokens = (await response.clone().json()).tokens;
      return response;
    }),
  );
  render(
    <Provider store={makeStore({ getAccessToken: async () => "token" })}>
      <Page />
    </Provider>,
  );
  return save;
}

const box = (name: string) => screen.getByRole("checkbox", { name }) as HTMLInputElement;

it("checks a box the moment it is pressed, and keeps every box usable while it saves", async () => {
  let release = () => {};
  const save = serve(
    () =>
      new Promise((resolve) => {
        release = () => resolve(Response.json({ tokens: [USDC, { ...OUSD, on: true }] }));
      }),
  );
  await screen.findByRole("checkbox", { name: "OUSD on every network" });
  act(() => box("OUSD on every network").click());
  await waitFor(() => expect(save.sent).toBe(true));
  expect(box("OUSD on every network").checked).toBe(true);
  expect(box("USDC on every network").disabled).toBe(false);
  release();
  await screen.findByText("Changes saved.");
  expect(box("OUSD on every network").checked).toBe(true);
});

it("puts the boxes back when the save is refused", async () => {
  serve(async () => Response.json({ error: { code: "invalid_request" } }, { status: 400 }));
  await screen.findByRole("checkbox", { name: "OUSD on every network" });
  act(() => box("OUSD on every network").click());
  await screen.findByRole("alert");
  expect(box("OUSD on every network").checked).toBe(false);
});
