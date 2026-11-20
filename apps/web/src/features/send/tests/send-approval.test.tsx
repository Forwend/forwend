// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SEND_COPY } from "@/features/send/constants/send-copy";
import { useSendApproval } from "@/features/send/hooks/use-send-approval";
import type { Send } from "@/features/send/types/send";
import { makeStore } from "@/store/store";

const privy = vi.hoisted(() => ({
  sign: vi.fn(async () => ({ txHash: "0xhash" })),
  mfa: {
    needed: false,
    enrolled: false,
    verify: vi.fn(async () => {}),
    forget: vi.fn(async () => {}),
  },
}));
vi.mock("@/features/auth/hooks/use-wallet-mfa", () => ({ useWalletMfa: () => privy.mfa }));
vi.mock("@/features/auth/hooks/use-fresh-sign-in", () => ({
  useFreshSignIn: () => ({
    run: (request: () => unknown) => request(),
    step: null,
    cancelled: () => false,
    cancel: vi.fn(),
  }),
}));
vi.mock("@/features/auth/hooks/use-mfa-step", () => ({
  useMfaStep: () => ({
    run: (action: () => unknown) => action(),
    step: null,
    busy: false,
    cancel: vi.fn(),
  }),
}));
vi.mock("@/features/send/hooks/use-sign-send", () => ({
  useSignSend: () => ({ sign: privy.sign, canSign: true }),
}));

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
  status: "prepared",
  final: false,
  txHash: null,
  failure: null,
  networkFee: { amount: "0", paidBy: "forwend" },
  gas: null,
  warnings: [],
  createdAt: "2026-11-06T10:00:00Z",
};

// Answers each approve in turn; every other request succeeds.
function server(...approvals: (() => Response | Promise<Response>)[]) {
  const requests: { path: string; body: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.split("/").at(-1) ?? "";
      requests.push({ path, body: await request.text() });
      if (path === "approve") return (approvals.shift() ?? (() => Response.json(send)))();
      return Response.json({ ...send, status: "sending", txHash: "0xhash" });
    }),
  );
  return {
    approves: () => requests.filter((r) => r.path === "approve").length,
    submits: () => requests.filter((r) => r.path === "submit").map((r) => JSON.parse(r.body)),
  };
}
const status = (value: string) => () => Response.json({ ...send, status: value });

function approval() {
  const signing: boolean[] = [];
  const onSubmitted = vi.fn();
  const store = makeStore({ getAccessToken: async () => "token" });
  const hook = renderHook(
    () =>
      useSendApproval({
        profileId: "p1",
        send,
        onSigning: (on) => {
          signing.push(on);
        },
        onSubmitted,
      }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Provider store={store}>{children}</Provider>
      ),
    },
  );
  return { hook, signing, onSubmitted };
}

afterEach(() => {
  vi.clearAllMocks();
  privy.mfa.needed = false;
  privy.mfa.enrolled = false;
});

describe("approving a send", () => {
  it("signs only a send the server approved just now, and reports its hash", async () => {
    const api = server(status("expired"), status("approved"));
    const stale = approval();
    await act(() => stale.hook.result.current.start());
    expect(stale.hook.result.current.error).toBe(SEND_COPY.outOfDate);
    expect(privy.sign).not.toHaveBeenCalled();
    expect(stale.signing).toEqual([]);

    const current = approval();
    await act(() => current.hook.result.current.start());
    expect(privy.sign).toHaveBeenCalledOnce();
    expect(api.submits()).toEqual([{ txHash: "0xhash" }]);
    expect(current.onSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({ status: "sending", txHash: "0xhash" }),
      null,
    );
    expect(current.signing).toEqual([true]);
  });

  it("holds the sheet locked from the hold on, while the approve answer is on its way", async () => {
    let answer: (response: Response) => void = () => {};
    const api = server(() => new Promise<Response>((resolve) => (answer = resolve)));
    const { hook } = approval();
    expect(hook.result.current.locked).toBe(false);
    act(() => void hook.result.current.start());
    await waitFor(() => expect(api.approves()).toBe(1));
    expect(hook.result.current.locked).toBe(true);
    await act(async () => answer(status("expired")()));
    await waitFor(() => expect(hook.result.current.locked).toBe(false));
  });

  it("never signs a send approved before", async () => {
    const api = server(() =>
      Response.json({ error: { code: "send_approved", message: "approved" } }, { status: 409 }),
    );
    const { hook, signing } = approval();
    await act(() => hook.result.current.start());
    expect(hook.result.current.error).toBe(SEND_COPY.alreadyApproved);
    expect(privy.sign).not.toHaveBeenCalled();
    expect(api.submits()).toEqual([]);
    expect(signing).toEqual([]);
  });

  it("sets up two-step as the next step, and approves and signs nothing meanwhile", async () => {
    privy.mfa.needed = true;
    const api = server();
    const { hook } = approval();
    await act(() => hook.result.current.start());
    expect(hook.result.current.settingUp).toBe(true);
    expect(api.approves()).toBe(0);
    expect(privy.sign).not.toHaveBeenCalled();
    act(() => hook.result.current.cancelConfirm());
    expect(hook.result.current.settingUp).toBe(false);
  });

  it("approves nothing when the two-step code is closed, and drops the code after a send", async () => {
    privy.mfa.enrolled = true;
    privy.mfa.verify.mockRejectedValueOnce(new Error("MFA canceled"));
    const api = server(status("approved"));
    const closed = approval();
    await act(() => closed.hook.result.current.start());
    expect(api.approves()).toBe(0);
    expect(closed.hook.result.current.error).toBeNull();
    expect(closed.hook.result.current.working).toBe(false);

    const { hook } = approval();
    await act(() => hook.result.current.start());
    expect(api.approves()).toBe(1);
    expect(privy.sign).toHaveBeenCalledOnce();
    expect(privy.mfa.forget).toHaveBeenCalledOnce();
  });

  it("starts one send however many times Send is held", async () => {
    let answer: (response: Response) => void = () => {};
    const api = server(() => new Promise<Response>((resolve) => (answer = resolve)));
    const { hook } = approval();
    act(() => void hook.result.current.start());
    await act(() => hook.result.current.start());
    await waitFor(() => expect(api.approves()).toBe(1));
    await act(async () => answer(status("approved")()));
    await waitFor(() => expect(privy.sign).toHaveBeenCalledOnce());
    expect(api.approves()).toBe(1);
  });
});
