// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FreshSignInProvider, useFreshSignIn } from "@/features/auth/components/fresh-sign-in";
import type { AskFreshSignIn } from "@/shared/api/fresh-sign-in";

// Forwend's own code routes (R-137), as the api answers them.
const api = vi.hoisted(() => ({
  // As the api answers a code it sent: 0 lets the tests resend at once.
  sendCode: vi.fn(async () => ({ resendAfterSeconds: 0 })),
  verifyCode: vi.fn(async (_: string) => {}),
}));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({
    user: {
      email: { address: "owner@example.com" },
      linkedAccounts: [{ type: "email" }],
    },
  }),
}));
vi.mock("@/features/auth/api/auth-api", () => ({
  useSendFreshCodeMutation: () => [() => ({ unwrap: api.sendCode })],
  useVerifyFreshCodeMutation: () => [(code: string) => ({ unwrap: () => api.verifyCode(code) })],
}));

let ask: AskFreshSignIn = async () => false;
const answers: boolean[] = [];
// What the form saw of the API's answer: cancelled is true only when the user gave up.
const cancelled: boolean[] = [];
const refused = { status: 401, data: { error: { code: "reauth_required" } } };

// A form like New key: its request asks for a fresh sign-in, and the step shows in place of its buttons.
function Form() {
  const fresh = useFreshSignIn();
  return (
    <form>
      <fieldset disabled={fresh.pending}>
        <input aria-label="Name" defaultValue="Server" />
      </fieldset>
      {fresh.step ?? (
        <button
          type="button"
          onClick={() =>
            void fresh
              .run(async () => {
                const ok = await ask();
                answers.push(ok);
                // The API still refuses, whether the user gave up or not.
                throw refused;
              })
              .catch((error) => cancelled.push(fresh.cancelled(error)))
          }
        >
          Make key
        </button>
      )}
    </form>
  );
}

function renderForm() {
  render(
    <FreshSignInProvider register={(fn) => (ask = fn)}>
      <Form />
    </FreshSignInProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Make key" }));
}

beforeEach(() => {
  answers.length = 0;
  cancelled.length = 0;
  vi.clearAllMocks();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(() => fn(0)));
});
afterEach(cleanup);

describe("fresh sign-in", () => {
  it("asks in place, with the form still shown and its fields locked, and a full code confirms it", async () => {
    renderForm();
    const step = await screen.findByRole("group", { name: "Confirm it's you" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Name").matches(":disabled")).toBe(true);
    await waitFor(() => expect(api.sendCode).toHaveBeenCalledTimes(1));
    await screen.findByText("Enter the 6-digit code sent to owner@example.com.");
    await screen.findByText(/Didn't get it\?/);
    // As on the sign-in page: the sixth digit confirms, with no click.
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "123456" } });
    await waitFor(() => expect(api.verifyCode).toHaveBeenCalledWith("123456"));
    await waitFor(() => expect(answers).toEqual([true]));
    expect(step.isConnected).toBe(false);
    expect(screen.getByLabelText("Name").matches(":disabled")).toBe(false);
  });

  it("says a wrong or expired code didn't work, keeps the step open, and tries the same code typed again", async () => {
    api.verifyCode.mockRejectedValueOnce(new Error("invalid code"));
    renderForm();
    await screen.findByText(/Didn't get it\?/);
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "000000" } });
    expect((await screen.findByRole("alert")).textContent).toBe("That code is wrong or expired.");
    expect(answers).toEqual([]);
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "000000" } });
    await waitFor(() => expect(api.verifyCode).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(answers).toEqual([true]));
  });

  it("counts down before it offers a new code", async () => {
    api.sendCode.mockResolvedValueOnce({ resendAfterSeconds: 30 });
    renderForm();
    await screen.findByText("Resend in 30s");
    expect(screen.queryByRole("button", { name: "Resend code" })).toBeNull();
  });

  it("sends a new code on request once the wait is over", async () => {
    renderForm();
    fireEvent.click(await screen.findByRole("button", { name: "Resend code" }));
    await waitFor(() => expect(api.sendCode).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "123456" } });
    await waitFor(() => expect(answers).toEqual([true]));
  });

  it("offers to send again when the code couldn't be sent", async () => {
    api.sendCode.mockRejectedValueOnce(new Error("rate limited"));
    renderForm();
    // Said once, under the code, and not as a wrong code: the boxes stay unmarked.
    await screen.findByText(/We couldn't send the code\./);
    expect(screen.getAllByText(/couldn't send/)).toHaveLength(1);
    expect(screen.getByLabelText("Code").getAttribute("aria-invalid")).not.toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText(/Didn't get it\?/);
    expect(api.sendCode).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "123456" } });
    await waitFor(() => expect(answers).toEqual([true]));
  });

  it("takes this session's code sent a moment ago as sent, but not a full hour's codes", async () => {
    const tooSoon = { status: 429, data: { error: { code: "code_sent_recently" } } };
    api.sendCode.mockRejectedValueOnce(tooSoon);
    renderForm();
    await screen.findByText(/Didn't get it\?/);
    cleanup();
    api.sendCode.mockRejectedValueOnce({
      status: 429,
      data: { error: { code: "too_many_codes" } },
    });
    renderForm();
    await screen.findByText(/We couldn't send the code\./);
  });

  it("tells an account with no login email that no code can come", async () => {
    api.sendCode.mockRejectedValueOnce({
      status: 409,
      data: { error: { code: "no_login_email" } },
    });
    renderForm();
    await screen.findByText(/your account has none/);
    expect(screen.queryByLabelText("Code")).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
  });

  it("still checks a code after a send failed: an earlier email's code may be the one", async () => {
    api.sendCode.mockRejectedValueOnce(new Error("resend down"));
    renderForm();
    await screen.findByText(/We couldn't send the code\./);
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "123456" } });
    await waitFor(() => expect(api.verifyCode).toHaveBeenCalledWith("123456"));
    await waitFor(() => expect(answers).toEqual([true]));
  });

  it("tells a retry still refused after the sign-in from a cancel", async () => {
    renderForm();
    await screen.findByText(/Didn't get it\?/);
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "123456" } });
    await waitFor(() => expect(cancelled).toEqual([false]));
  });

  it("answers no on Cancel and gives the form its buttons back", async () => {
    renderForm();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(answers).toEqual([false]));
    expect(screen.getByRole("button", { name: "Make key" })).toBeTruthy();
    await waitFor(() => expect(cancelled).toEqual([true]));
  });

  it("asks in a dialog of its own for a request no form claimed", async () => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
    render(
      <FreshSignInProvider register={(fn) => (ask = fn)}>
        <p>Page</p>
      </FreshSignInProvider>,
    );
    let answered: boolean | undefined;
    act(() => {
      void ask().then((ok) => (answered = ok));
    });
    // The dialog names it, so the step itself carries no second name; its Close gives up, so the step has no Cancel.
    await screen.findByText("Enter the 6-digit code sent to owner@example.com.");
    expect(screen.queryByRole("group", { name: "Confirm it's you", hidden: true })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel", hidden: true })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close", hidden: true }));
    await waitFor(() => expect(answered).toBe(false));
  });
});
