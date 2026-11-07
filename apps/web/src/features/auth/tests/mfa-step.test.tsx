// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MfaProvider, useMfaStep } from "@/features/auth/components/mfa-step";

// jsdom lacks the modal methods; the fallback dialog opens with them.
const proto = HTMLDialogElement.prototype as HTMLDialogElement & Record<string, unknown>;
if (typeof proto.showModal !== "function") {
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
}

const OPTIONS = { challenge: "c" };
const privy = vi.hoisted(() => ({
  ask: (_: { mfaMethods: string[] }) => {},
  init: vi.fn(async (_method: string) => ({ challenge: "c" }) as unknown),
  submit: vi.fn(async (_method: string, _answer: unknown) => {}),
  cancel: vi.fn(),
}));
vi.mock("@privy-io/react-auth", () => ({
  useMfa: () => ({ init: privy.init, submit: privy.submit, cancel: privy.cancel }),
  useRegisterMfaListener: (l: { onMfaRequired: typeof privy.ask }) => {
    privy.ask = l.onMfaRequired;
  },
  errorIndicatesMfaVerificationFailed: () => false,
  errorIndicatesMaxMfaRetries: () => false,
  errorIndicatesMfaTimeout: () => false,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// A form that signs: the ask shows where its buttons were.
function Form() {
  const mfa = useMfaStep();
  return (
    <div data-testid="form">
      <button type="button" onClick={() => void mfa.run(() => new Promise(() => {}))}>
        Sign
      </button>
      {mfa.step}
    </div>
  );
}

describe("Privy's two-step ask in Forwend's own step (R-219)", () => {
  it("shows in the form that started the action, and Cancel ends that action", () => {
    render(
      <MfaProvider>
        <Form />
      </MfaProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    act(() => privy.ask({ mfaMethods: ["totp"] }));
    expect(screen.getByTestId("form").contains(screen.getByLabelText("Authenticator code"))).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(privy.cancel).toHaveBeenCalledTimes(1);
  });

  // The send sheet can close while its setup waits for two-step: the ask ends with it, and the next one shows.
  it("ends the ask when its form goes away, and shows the next one elsewhere", () => {
    const view = render(
      <MfaProvider>
        <Form />
      </MfaProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    act(() => privy.ask({ mfaMethods: ["totp"] }));
    view.rerender(<MfaProvider>{null}</MfaProvider>);
    expect(privy.cancel).toHaveBeenCalledTimes(1);
    act(() => privy.ask({ mfaMethods: ["totp"] }));
    expect(screen.getByLabelText("Authenticator code", { selector: "input" })).toBeTruthy();
  });

  it("marks a wrong code on the code boxes", async () => {
    privy.submit.mockRejectedValueOnce(new Error("MFA verification failed, retry."));
    render(
      <MfaProvider>
        <Form />
      </MfaProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    act(() => privy.ask({ mfaMethods: ["totp"] }));
    const input = screen.getByLabelText("Authenticator code");
    fireEvent.change(input, { target: { value: "123456" } });
    await waitFor(() => expect(input.getAttribute("aria-invalid")).toBe("true"));
  });

  it("confirms with the passkey in one tap", async () => {
    render(
      <MfaProvider>
        <Form />
      </MfaProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    act(() => privy.ask({ mfaMethods: ["passkey"] }));
    fireEvent.click(screen.getByRole("button", { name: "Continue with passkey" }));
    await waitFor(() => expect(privy.submit).toHaveBeenCalledWith("passkey", OPTIONS));
    expect(privy.init).toHaveBeenCalledWith("passkey");
  });
});
