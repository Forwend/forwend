// @vitest-environment jsdom
import { TooltipProvider } from "@forwend/ui-web";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/features/profiles/types/profile";
import { SendProgress } from "@/features/send/components/send-progress";
import { SendReview } from "@/features/send/components/send-review";
import type { Send } from "@/features/send/types/send";

const api = vi.hoisted(() => ({
  submit: vi.fn(async (): Promise<unknown> => ({})),
  sign: vi.fn(async () => "0xhash"),
  read: { currentData: undefined as unknown, fulfilledTimeStamp: 1 },
}));
vi.mock("@/features/send/api/send-api", () => ({
  useSubmitSendMutation: () => [() => ({ unwrap: api.submit })],
  useGetSendQuery: () => ({ ...api.read, refetch: () => {} }),
  // The review reads the send again before signing: it is still prepared.
  useLazyGetSendQuery: () => [() => ({ unwrap: async () => send })],
}));
vi.mock("@/features/send/hooks/use-sign-send", () => ({
  useSignSend: () => ({ sign: api.sign, canSign: true }),
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
  it("stays on from signing until the progress step holds the hash", async () => {
    const signing: boolean[] = [];
    const onSubmitted = vi.fn();
    render(
      <SendReview
        mode="send"
        send={send}
        option={option}
        from={{ profileId: "p1", kind: "personal", name: "Me" } as unknown as Profile}
        recipient={recipient}
        onSigning={(on) => signing.push(on)}
        onSubmitted={onSubmitted}
      />,
      { wrapper: TooltipProvider },
    );
    fireEvent.click(screen.getByRole("button", { name: /^Send 1/ }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    expect(signing).toEqual([true]);
  });

  it("lets the sheet close when the server refuses the hash, but not when it can't be reached", async () => {
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
  });
});
