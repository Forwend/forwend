// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SEND_COPY } from "@/features/send/constants/send-copy";
import { useSendApproval } from "@/features/send/hooks/use-send-approval";
import type { Send } from "@/features/send/types/send";

const api = vi.hoisted(() => ({
  approve: vi.fn(),
  record: vi.fn(),
  emailedCode: false,
  submit: vi.fn(async (): Promise<unknown> => ({})),
  sign: vi.fn(async () => ({ txHash: "0xhash" })),
  mfa: {
    needed: false,
    enrolled: false,
    verify: vi.fn(async () => {}),
    forget: vi.fn(async () => {}),
  },
}));
vi.mock("@/features/auth/hooks/use-wallet-mfa", () => ({ useWalletMfa: () => api.mfa }));
vi.mock("@/features/auth/components/fresh-sign-in", () => ({
  useFreshSignIn: () => ({
    run: (send: () => unknown) => send(),
    step: null,
    pending: api.emailedCode,
    cancelled: () => false,
    cancel: vi.fn(),
  }),
}));
vi.mock("@/features/auth/components/mfa-step", () => ({
  useMfaStep: () => ({
    run: (action: () => unknown) => action(),
    step: null,
    busy: false,
    cancel: vi.fn(),
  }),
}));
vi.mock("@/features/auth/api/auth-api", () => ({
  useRecordTwoStepMutation: () => [() => ({ unwrap: api.record })],
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

afterEach(() => {
  vi.clearAllMocks();
  api.mfa.needed = false;
  api.mfa.enrolled = false;
  api.emailedCode = false;
});

describe("approving a send (R-137, D-49)", () => {
  it("signs only a send the server approved just now", async () => {
    api.approve.mockResolvedValueOnce({ ...send, status: "expired" });
    const stale = approval();
    await act(() => stale.hook.result.current.start());
    expect(stale.hook.result.current.error).toBe(SEND_COPY.outOfDate);
    expect(api.sign).not.toHaveBeenCalled();
    expect(stale.signing).toEqual([]);

    api.approve.mockResolvedValueOnce({ ...send, status: "approved" });
    const current = approval();
    await act(() => current.hook.result.current.start());
    expect(api.sign).toHaveBeenCalledTimes(1);
    expect(current.onSubmitted).toHaveBeenCalledTimes(1);
    // The lock comes on for signing and stays: the progress step lifts it once the server holds the hash.
    expect(current.signing).toEqual([true]);
  });

  it("holds the sheet locked from the hold on, while the approve answer is on its way", async () => {
    let answer: (s: Send) => void = () => {};
    api.approve.mockReturnValueOnce(new Promise<Send>((r) => (answer = r)));
    const { hook } = approval();
    expect(hook.result.current.locked).toBe(false);
    act(() => void hook.result.current.start());
    // Closing or Back now could leave a send that is signed anyway once the answer comes.
    expect(hook.result.current.locked).toBe(true);
    await act(async () => answer({ ...send, status: "expired" }));
    expect(hook.result.current.locked).toBe(false);
  });

  // A signature whose answer was lost may have gone out: the server refuses a second approve, so it is never signed again.
  it("never signs a send approved before", async () => {
    api.approve.mockRejectedValueOnce({ status: 409, data: { error: { code: "send_approved" } } });
    const { hook, signing } = approval();
    await act(() => hook.result.current.start());
    expect(hook.result.current.error).toBe(SEND_COPY.alreadyApproved);
    expect(api.sign).not.toHaveBeenCalled();
    expect(signing).toEqual([]);
  });

  // R-219: Privy asks for the owner's second step before it signs, so it is set up first, as the sheet's next step.
  it("sets up two-step as the next step, and approves and signs nothing meanwhile", async () => {
    api.mfa.needed = true;
    const { hook } = approval();
    await act(() => hook.result.current.start());
    expect(hook.result.current.settingUp).toBe(true);
    expect(api.approve).not.toHaveBeenCalled();
    expect(api.sign).not.toHaveBeenCalled();
    act(() => hook.result.current.cancelConfirm());
    expect(hook.result.current.settingUp).toBe(false);
  });

  // D-49: only the setup records two-step methods. A send that also needed the emailed code would record whatever
  // Privy lists, such as an app a stolen session set up there, and that app would then approve sends alone.
  it("records no two-step methods, even after a send confirmed with the emailed code", async () => {
    api.mfa.enrolled = true;
    api.emailedCode = true;
    api.approve.mockResolvedValueOnce({ ...send, status: "approved" });
    const { hook } = approval();
    await act(() => hook.result.current.start());
    expect(api.sign).toHaveBeenCalledTimes(1);
    expect(api.record).not.toHaveBeenCalled();
  });

  // D-49: the code comes before the approve, so closing it leaves nothing approved; the next hold starts afresh.
  it("asks for the two-step code before approving, and approves nothing when it is closed", async () => {
    api.mfa.enrolled = true;
    api.mfa.verify.mockRejectedValueOnce(new Error("MFA canceled"));
    const closed = approval();
    await act(() => closed.hook.result.current.start());
    expect(api.approve).not.toHaveBeenCalled();
    expect(closed.hook.result.current.error).toBeNull();
    expect(closed.hook.result.current.working).toBe(false);

    api.approve.mockResolvedValueOnce({ ...send, status: "approved" });
    const { hook } = approval();
    await act(() => hook.result.current.start());
    expect(api.mfa.verify).toHaveBeenCalledBefore(api.approve);
    expect(api.sign).toHaveBeenCalledTimes(1);
    // The code was for this send: Privy's 15 minutes end with it.
    expect(api.mfa.forget).toHaveBeenCalledTimes(1);
  });

  it("starts one send however many times Send is held", async () => {
    let answer: (s: Send) => void = () => {};
    api.approve.mockReturnValueOnce(new Promise<Send>((r) => (answer = r)));
    const { hook } = approval();
    act(() => void hook.result.current.start());
    await act(() => hook.result.current.start());
    await act(async () => answer({ ...send, status: "approved" }));
    expect(api.approve).toHaveBeenCalledTimes(1);
    expect(api.sign).toHaveBeenCalledTimes(1);
  });
});
