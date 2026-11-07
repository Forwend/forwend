// @vitest-environment jsdom
import { ToastProvider } from "@forwend/ui-web";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TwoStepSetup } from "@/features/auth/components/two-step-setup";
import { TWO_STEP_COPY } from "@/features/auth/constants/auth-copy";

const privy = vi.hoisted(() => ({
  methods: ["passkey"] as string[],
  passkeys: [] as string[],
  promptMfa: vi.fn(async () => {}),
  addPasskey: vi.fn(async () => "new"),
  submitEnrollmentWithPasskey: vi.fn(async (_: { credentialIds: string[] }, __: unknown) => {}),
  submitEnrollmentWithTotp: vi.fn(async (_: { mfaCode: string }) => {
    throw new Error("MFA verification failed, retry.");
  }),
}));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({
    user: {
      mfaMethods: privy.methods,
      linkedAccounts: privy.passkeys.map((credentialId) => ({ type: "passkey", credentialId })),
    },
  }),
  useUser: () => ({ refreshUser: vi.fn(async () => ({ linkedAccounts: [] })) }),
  useMfa: () => ({ promptMfa: privy.promptMfa }),
  useMfaEnrollment: () => ({
    initEnrollmentWithTotp: async () => ({ secret: "JBSWY3DPEHPK3PXP", authUrl: "otpauth://x" }),
    submitEnrollmentWithTotp: privy.submitEnrollmentWithTotp,
    submitEnrollmentWithPasskey: privy.submitEnrollmentWithPasskey,
  }),
  // Privy gives a wrong code the same error type as a missing two-step answer.
  errorIndicatesMfaVerificationFailed: () => true,
}));
vi.mock("@/features/auth/api/auth-api", () => ({
  useCheckFreshSignInMutation: () => [() => ({ unwrap: async () => ({}) })],
  useRecordTwoStepMutation: () => [vi.fn()],
}));
vi.mock("@/features/auth/components/fresh-sign-in", () => ({
  useFreshSignIn: () => ({ run: (f: () => unknown) => f(), step: null, cancelled: () => false }),
}));
vi.mock("@/features/auth/components/mfa-step", () => ({
  useMfaStep: () => ({ run: (a: () => unknown) => a(), step: null }),
}));
vi.mock("@/features/auth/hooks/use-add-passkey", () => ({ useAddPasskey: () => privy.addPasskey }));

const get = vi.fn(async (_: CredentialRequestOptions) => ({ id: "mine" }) as Credential);
Object.defineProperty(navigator, "credentials", { value: { get }, configurable: true });

const setup = (only: "passkey" | "totp") =>
  render(
    <ToastProvider>
      <TwoStepSetup only={only} onDone={vi.fn()} onCancel={vi.fn()} />
    </ToastProvider>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  privy.methods = ["passkey"];
  privy.passkeys = [];
});

describe("Setting up two-step (R-219)", () => {
  it("shows a wrong app code on the code boxes, without asking for the passkey", async () => {
    setup("totp");
    const input = await screen.findByLabelText(TWO_STEP_COPY.enterSetupCode);
    fireEvent.change(input, { target: { value: "123456" } });
    await waitFor(() => expect(input.getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByRole("alert").textContent).toBe(TWO_STEP_COPY.wrongCode);
    expect(privy.submitEnrollmentWithTotp).toHaveBeenCalledTimes(1);
    expect(privy.promptMfa).not.toHaveBeenCalled();
  });

  // D-49: Privy turns on any linked passkey by its ID with no tap, so one a stolen session linked must never ride along.
  it("turns on only the passkey the owner taps on this device", async () => {
    privy.methods = [];
    privy.passkeys = ["mine", "theirs"];
    setup("passkey");
    expect(privy.submitEnrollmentWithPasskey).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: TWO_STEP_COPY.usePasskey }));
    await waitFor(() => expect(privy.submitEnrollmentWithPasskey).toHaveBeenCalledTimes(1));
    expect(privy.submitEnrollmentWithPasskey.mock.calls[0]?.[0]).toEqual({
      credentialIds: ["mine"],
    });
    expect(get.mock.calls[0]?.[0].publicKey?.allowCredentials).toHaveLength(2);
  });

  it("makes a passkey here when none of the account's is on this device, and turns on only that one", async () => {
    privy.methods = [];
    privy.passkeys = ["theirs"];
    get.mockRejectedValueOnce(new DOMException("none here", "NotAllowedError"));
    setup("passkey");
    fireEvent.click(screen.getByRole("button", { name: TWO_STEP_COPY.usePasskey }));
    fireEvent.click(
      await screen.findByRole("button", { name: TWO_STEP_COPY.createPasskeyInstead }),
    );
    fireEvent.click(screen.getByRole("button", { name: TWO_STEP_COPY.createPasskey }));
    await waitFor(() => expect(privy.submitEnrollmentWithPasskey).toHaveBeenCalledTimes(1));
    expect(privy.submitEnrollmentWithPasskey.mock.calls[0]?.[0]).toEqual({
      credentialIds: ["new"],
    });
  });
});
