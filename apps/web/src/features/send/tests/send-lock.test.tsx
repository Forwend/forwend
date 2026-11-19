// @vitest-environment jsdom
import { TooltipProvider } from "@forwend/ui-web";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendApi } from "@/features/send/api/send-api";
import { SendProgress } from "@/features/send/components/send-progress";
import type { Relay, Send } from "@/features/send/types/send";
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

const send: Send = {
  sendId: "11111111-1111-4111-8111-111111111111",
  chainId: 84532,
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  symbol: "USDC",
  decimals: 6,
  from: "0x1111111111111111111111111111111111111111",
  to: "0x2222222222222222222222222222222222222222",
  toProfileId: null,
  amount: "1000000",
  status: "sending",
  final: false,
  txHash: null,
  failure: null,
  networkFee: { amount: "0", paidBy: "forwend" },
  gas: null,
  warnings: [],
  createdAt: "2026-11-06T10:00:00Z",
};
const paymaster: Send = { ...send, networkFee: { amount: "12000", paidBy: "paymaster" } };
const option = {
  chainId: 84532,
  token: send.token,
  symbol: "USDC",
  decimals: 6,
  balance: 5n,
  sendable: true,
};
type Answer = () => Response | Promise<Response>;
const json =
  (body: unknown, status = 200) =>
  () =>
    Response.json(body, { status });
const down = () => Promise.reject(new TypeError("Failed to fetch"));

function progress({
  read,
  submit = json(send),
  initial,
  relay = null,
}: {
  read: Answer;
  submit?: Answer;
  initial: Send;
  relay?: Relay | null;
}) {
  const submits: unknown[] = [];
  let posts = 0;
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      if (request.method === "POST") {
        posts += 1;
        submits.push(JSON.parse(await request.text()));
        return submit();
      }
      reads += 1;
      return read();
    }),
  );
  const store = makeStore({ getAccessToken: async () => "token" });
  const holding: boolean[] = [];
  render(
    <Provider store={store}>
      <TooltipProvider>
        <SendProgress
          profileId="p1"
          initial={initial}
          relay={relay}
          option={option}
          recipient={{ address: send.to }}
          onSent={() => {}}
          onHolding={(on) => {
            holding.push(on);
          }}
          onDone={() => {}}
        />
      </TooltipProvider>
    </Provider>,
  );
  // The store tells subscribers on the next animation frame.
  const reread = () =>
    act(async () => {
      await store.dispatch(
        sendApi.endpoints.getSend.initiate(
          { profileId: "p1", sendId: send.sendId },
          { forceRefetch: true, subscribe: false },
        ),
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
  return { submits, holding, posts: () => posts, reads: () => reads, reread };
}

afterEach(cleanup);

describe("the send sheet's lock", () => {
  it("lets the sheet close when the server refuses the hash, not when one report fails", async () => {
    const refused = progress({
      read: json(send),
      submit: json({ error: { code: "invalid_value", message: "no" } }, 422),
      initial: { ...send, txHash: "0xhash" },
    });
    await waitFor(() => expect(refused.holding.at(-1)).toBe(false));
    expect(refused.submits).toEqual([{ txHash: "0xhash" }]);
    cleanup();

    const lost = progress({
      read: json(send),
      submit: down,
      initial: { ...send, txHash: "0xhash" },
    });
    await waitFor(() => expect(lost.submits).toHaveLength(1));
    await lost.reread();
    await waitFor(() => expect(lost.submits).toHaveLength(2));
    expect(lost.holding.at(-1)).toBe(true);
  });

  it("lets the sheet close when the server can't be read", async () => {
    const unread = progress({ read: down, submit: down, initial: { ...send, txHash: "0xhash" } });
    await waitFor(() => expect(unread.holding.at(-1)).toBe(false));
  });

  it("sends a paymaster send's signature again while it is valid, then shows it not sent", async () => {
    const live = progress({
      read: json({ ...paymaster, status: "expired" }),
      submit: json(paymaster),
      initial: paymaster,
      relay: { signature: "sig-1", until: Date.now() + 60_000 },
    });
    await waitFor(() => expect(live.submits).toContainEqual({ signature: "sig-1" }));
    expect(live.holding.every((on) => !on)).toBe(true);
    expect(screen.queryByText("Not sent")).toBeNull();
    cleanup();

    const late = progress({
      read: json({ ...paymaster, status: "expired" }),
      initial: paymaster,
      relay: { signature: "sig-1", until: Date.now() - 1 },
    });
    expect(await screen.findByText("Not sent")).toBeTruthy();
    expect(late.submits).toEqual([]);
  });

  it("keeps following an expired wallet-paid send, whose hash it reports again", async () => {
    const view = progress({
      read: json({ ...send, status: "expired" }),
      initial: { ...send, txHash: "0xhash" },
    });
    await waitFor(() => expect(view.submits).toContainEqual({ txHash: "0xhash" }));
    expect(screen.queryByText("Not sent")).toBeNull();
  });

  it("sends a signature once at a time, however often the send is read", async () => {
    let finish: () => void = () => {};
    const view = progress({
      read: json({ ...paymaster, status: "approved" }),
      submit: () =>
        new Promise<Response>((resolve) => {
          finish = () => resolve(Response.json(paymaster));
        }),
      initial: paymaster,
      relay: { signature: "sig-1", until: Date.now() + 60_000 },
    });
    await waitFor(() => expect(view.posts()).toBe(1));
    const reads = view.reads();
    await view.reread();
    await view.reread();
    expect(view.reads()).toBeGreaterThan(reads + 1);
    expect(view.posts()).toBe(1);
    finish();
    await view.reread();
    await waitFor(() => expect(view.posts()).toBe(2));
  });
});
