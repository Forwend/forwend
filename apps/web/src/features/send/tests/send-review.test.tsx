// @vitest-environment jsdom
import { TooltipProvider } from "@forwend/ui-web";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/features/profiles/types/profile";
import { SendReview } from "@/features/send/components/send-review";
import type { Send } from "@/features/send/types/send";

const api = vi.hoisted(() => ({
  read: vi.fn(),
  sign: vi.fn(async () => "0xhash"),
  submit: vi.fn(),
}));
vi.mock("@/features/send/api/send-api", () => ({
  useLazyGetSendQuery: () => [() => ({ unwrap: api.read })],
  useSubmitSendMutation: () => [(arg: unknown) => ({ unwrap: async () => api.submit(arg) })],
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
  gas: null,
  warnings: [],
  createdAt: "2026-11-06T10:00:00Z",
} as Send;

function renderReview() {
  render(
    <SendReview
      mode="send"
      send={send}
      option={{
        chainId: 84532,
        token: send.token,
        symbol: "USDC",
        decimals: 6,
        balance: 5n,
        sendable: true,
      }}
      from={{ profileId: "p1", kind: "personal", name: "Me" } as unknown as Profile}
      recipient={{ address: send.to }}
      onSigning={() => {}}
      onSubmitted={() => {}}
    />,
    { wrapper: TooltipProvider },
  );
  fireEvent.click(screen.getByRole("button", { name: /^Send 1/ }));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the send review", () => {
  it("signs only a send the server still holds as prepared", async () => {
    api.read.mockResolvedValueOnce({ ...send, status: "expired" });
    renderReview();
    expect((await screen.findByRole("alert")).textContent).toContain("out of date");
    expect(api.sign).not.toHaveBeenCalled();

    cleanup();
    api.read.mockResolvedValueOnce(send);
    renderReview();
    await waitFor(() => expect(api.sign).toHaveBeenCalledTimes(1));
  });
});
