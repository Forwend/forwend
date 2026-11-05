// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FreshSignInProvider, useFreshSignIn } from "@/features/auth/components/fresh-sign-in";
import type { AskFreshSignIn } from "@/shared/api/fresh-sign-in";

const privy = vi.hoisted(() => ({
  sendCode: vi.fn(async () => {}),
  loginWithCode: vi.fn(async (_: { code: string }) => {}),
}));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({
    user: {
      email: { address: "owner@example.com" },
      linkedAccounts: [{ type: "email" }],
    },
  }),
  useLoginWithEmail: () => ({ sendCode: privy.sendCode, loginWithCode: privy.loginWithCode }),
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
    await waitFor(() =>
      expect(privy.sendCode).toHaveBeenCalledWith({ email: "owner@example.com" }),
    );
    await screen.findByText(/We sent a code to owner@example.com/);
    // As on the sign-in page: the sixth digit confirms, with no click.
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "123456" } });
    await waitFor(() => expect(privy.loginWithCode).toHaveBeenCalledWith({ code: "123456" }));
    await waitFor(() => expect(answers).toEqual([true]));
    expect(step.isConnected).toBe(false);
    expect(screen.getByLabelText("Name").matches(":disabled")).toBe(false);
  });

  it("says a wrong or expired code didn't work, keeps the step open, and tries the same code typed again", async () => {
    privy.loginWithCode.mockRejectedValueOnce(new Error("invalid code"));
    renderForm();
    await screen.findByText(/We sent a code/);
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "000000" } });
    expect((await screen.findByRole("alert")).textContent).toContain("Wrong or expired code");
    expect(answers).toEqual([]);
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "000000" } });
    await waitFor(() => expect(privy.loginWithCode).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(answers).toEqual([true]));
  });

  it("sends a new code on request", async () => {
    renderForm();
    await screen.findByText(/We sent a code/);
    fireEvent.click(screen.getByRole("button", { name: "Send a new one" }));
    await waitFor(() => expect(privy.sendCode).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "123456" } });
    await waitFor(() => expect(answers).toEqual([true]));
  });

  it("offers to send again when the code couldn't be sent", async () => {
    privy.sendCode.mockRejectedValueOnce(new Error("rate limited"));
    renderForm();
    await screen.findByText(/We couldn't send a code to owner@example.com/);
    fireEvent.click(screen.getByRole("button", { name: "Send a code" }));
    await screen.findByText(/We sent a code to owner@example.com/);
    expect(privy.sendCode).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "123456" } });
    await waitFor(() => expect(answers).toEqual([true]));
  });

  it("tells a retry still refused after the sign-in from a cancel", async () => {
    renderForm();
    await screen.findByText(/We sent a code/);
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
    // The dialog names it, so the step itself carries no second name.
    await screen.findByText(/We sent a code to owner@example.com/);
    expect(screen.queryByRole("group", { name: "Confirm it's you", hidden: true })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel", hidden: true }));
    await waitFor(() => expect(answered).toBe(false));
  });
});
