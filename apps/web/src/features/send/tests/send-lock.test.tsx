// @vitest-environment jsdom
import { TooltipProvider } from "@forwend/ui-web";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SendProgress } from "@/features/send/components/send-progress";
import type { Send } from "@/features/send/types/send";

const api = vi.hoisted(() => ({
  submit: vi.fn(async (): Promise<unknown> => ({})),
  read: { currentData: undefined as unknown, fulfilledTimeStamp: 1, error: undefined as unknown },
}));
vi.mock("@/features/send/api/send-api", () => ({
  useSubmitSendMutation: () => [() => ({ unwrap: api.submit })],
  useGetSendQuery: () => ({ ...api.read, refetch: () => {} }),
}));

const send = {
  sendId: "11111111-1111-4111-8111-111111111111",
  chainId: 84532,
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  symbol: "USDC",
  decimals: 6,
  from: "0x1111111111111111111111111111111111111111",
  to: "0x2222222222222222222222222222222222222222",
  toProfileId: null,
  amount: "1000000",
  status: "prepared",
  final: false,
  txHash: null,
  failure: null,
  networkFee: { amount: "0", paidBy: "forwend" },
  warnings: [],
  createdAt: "2026-11-06T10:00:00Z",
} as unknown as Send;
const option = {
  chainId: 84532,
  token: send.token,
  symbol: "USDC",
  decimals: 6,
  balance: 5n,
  sendable: true,
};
const recipient = { address: send.to };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the send sheet's lock (R-214)", () => {
  it("lets the sheet close when the server refuses the hash or can't be read, not when one report fails", async () => {
    api.read.currentData = { ...send, status: "sending", txHash: null };
    const holding = (error: unknown) => {
      api.submit.mockRejectedValue(error);
      const seen: boolean[] = [];
      render(
        <SendProgress
          profileId="p1"
          initial={{ ...send, status: "sending", txHash: "0xhash" } as Send}
          option={option}
          recipient={recipient}
          onSent={() => {}}
          onHolding={(on) => {
            seen.push(on);
          }}
          onDone={() => {}}
        />,
        { wrapper: TooltipProvider },
      );
      return seen;
    };
    const refused = holding({ status: 422, data: { error: { code: "invalid_value" } } });
    await waitFor(() => expect(refused.at(-1)).toBe(false));
    cleanup();
    const down = holding({ status: "FETCH_ERROR" });
    await waitFor(() => expect(api.submit).toHaveBeenCalled());
    // The rejection is handled and any state it sets rendered before the check.
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(down.at(-1)).toBe(true);
    cleanup();
    // A server that can't be read lifts it: the owner may leave, and the transfer still shows in Transactions.
    api.read.error = { status: "FETCH_ERROR" };
    const unread = holding({ status: "FETCH_ERROR" });
    await waitFor(() => expect(unread.at(-1)).toBe(false));
    api.read.error = undefined;
  });
});
