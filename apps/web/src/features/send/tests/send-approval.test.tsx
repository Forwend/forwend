// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SEND_COPY } from "@/features/send/constants/send-copy";
import { useSendApproval } from "@/features/send/hooks/use-send-approval";
import type { Send } from "@/features/send/types/send";

const api = vi.hoisted(() => ({
  approve: vi.fn(),
  submit: vi.fn(async (): Promise<unknown> => ({})),
  sign: vi.fn(async () => "0xhash"),
}));
vi.mock("@/features/send/api/send-api", () => ({
  useApproveSendMutation: () => [() => ({ unwrap: api.approve })],
  useSubmitSendMutation: () => [() => ({ unwrap: api.submit })],
}));
vi.mock("@/features/send/hooks/use-sign-send", () => ({
  useSignSend: () => ({ sign: api.sign, canSign: true }),
}));

const send = {
  sendId: "11111111-1111-4111-8111-111111111111",
  chainId: 84532,
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  from: "0x1111111111111111111111111111111111111111",
  to: "0x2222222222222222222222222222222222222222",
  amount: "1000000",
  status: "prepared",
  txHash: null,
} as unknown as Send;

function approval() {
  const signing: boolean[] = [];
  const onSubmitted = vi.fn();
  const hook = renderHook(() =>
    useSendApproval({
      profileId: "p1",
      send,
      onSigning: (on) => {
        signing.push(on);
      },
      onSubmitted,
    }),
  );
  return { hook, signing, onSubmitted };
}

afterEach(() => vi.clearAllMocks());

describe("approving a send (R-137, D-49)", () => {
  it("signs only a send the server still holds as prepared", async () => {
    api.approve.mockResolvedValueOnce({ ...send, status: "expired" });
    const stale = approval();
    await act(() => stale.hook.result.current.start());
    expect(stale.hook.result.current.error).toBe(SEND_COPY.outOfDate);
    expect(api.sign).not.toHaveBeenCalled();
    expect(stale.signing).toEqual([]);

    api.approve.mockResolvedValueOnce(send);
    const current = approval();
    await act(() => current.hook.result.current.start());
    expect(api.sign).toHaveBeenCalledTimes(1);
    expect(current.onSubmitted).toHaveBeenCalledTimes(1);
    // The lock comes on for signing and stays: the progress step lifts it once the server holds the hash.
    expect(current.signing).toEqual([true]);
  });

  it("starts one send however many times Send is held", async () => {
    let answer: (s: Send) => void = () => {};
    api.approve.mockReturnValueOnce(new Promise<Send>((r) => (answer = r)));
    const { hook } = approval();
    act(() => void hook.result.current.start());
    await act(() => hook.result.current.start());
    await act(async () => answer(send));
    expect(api.approve).toHaveBeenCalledTimes(1);
    expect(api.sign).toHaveBeenCalledTimes(1);
  });
});
