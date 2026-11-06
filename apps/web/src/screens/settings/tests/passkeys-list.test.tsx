// @vitest-environment jsdom
import { ToastProvider } from "@forwend/ui-web";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Passkeys } from "@/screens/settings/passkeys";

// jsdom lacks the modal methods; this is what the browser does that matters here.
const proto = HTMLDialogElement.prototype as HTMLDialogElement & Record<string, unknown>;
if (typeof proto.showModal !== "function") {
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

const privy = vi.hoisted(() => ({
  accounts: [] as unknown[],
  unlink: vi.fn(async (_: string) => ({})),
  link: vi.fn(async () => {}),
  check: vi.fn(async () => {}),
}));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ user: { linkedAccounts: privy.accounts }, unlinkPasskey: privy.unlink }),
  useLinkWithPasskey: () => ({ linkWithPasskey: privy.link }),
}));
vi.mock("@/features/auth/api/auth-api", () => ({
  useCheckFreshSignInMutation: () => [() => ({ unwrap: privy.check })],
}));

const passkey = {
  type: "passkey",
  credentialId: "cred-1",
  authenticatorName: "iCloud Keychain",
  createdWithBrowser: "Safari",
  createdWithOs: "macOS",
  firstVerifiedAt: new Date("2026-10-27T10:00:00Z"),
  latestVerifiedAt: new Date("2026-11-05T10:00:00Z"),
};
const email = { type: "email", address: "owner@example.com" };

const wrap = ({ children }: { children: ReactNode }) => <ToastProvider>{children}</ToastProvider>;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("passkeys in Account and security (R-217)", () => {
  it("lists a passkey with where it was made, when added and last used, and offers another", () => {
    privy.accounts = [email, passkey];
    render(<Passkeys />, { wrapper: wrap });
    expect(screen.getByText("iCloud Keychain")).toBeTruthy();
    expect(
      screen.getByText(/^Made on Safari, macOS · Added Oct 27 · Last used Nov 5$/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a passkey" })).toBeTruthy();
  });

  it("removes a passkey only after the dialog, once the api says the session is fresh", async () => {
    privy.accounts = [email, passkey];
    render(<Passkeys />, { wrapper: wrap });
    fireEvent.click(screen.getByRole("button", { name: "Remove iCloud Keychain" }));
    const dialog = screen.getByRole("dialog", { name: "Remove this passkey?" });
    expect(privy.unlink).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(privy.unlink).toHaveBeenCalledWith("cred-1"));
    expect(privy.check).toHaveBeenCalledBefore(privy.unlink);
  });

  it("leaves the passkey when the api can't say the session is fresh", async () => {
    privy.accounts = [email, passkey];
    privy.check.mockRejectedValueOnce({ status: 500 });
    render(<Passkeys />, { wrapper: wrap });
    fireEvent.click(screen.getByRole("button", { name: "Remove iCloud Keychain" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("The passkey was not removed. Try again.")).toBeTruthy();
    expect(privy.unlink).not.toHaveBeenCalled();
  });

  it("keeps the only way to sign in, and says why", () => {
    privy.accounts = [passkey];
    render(<Passkeys />, { wrapper: wrap });
    expect(
      (screen.getByRole("button", { name: "Remove iCloud Keychain" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText("It's your only way to sign in. Add another first.")).toBeTruthy();
  });

  it("adds another passkey once the api says the session is fresh", async () => {
    privy.accounts = [email, passkey];
    render(<Passkeys />, { wrapper: wrap });
    fireEvent.click(screen.getByRole("button", { name: "Add a passkey" }));
    await waitFor(() => expect(privy.link).toHaveBeenCalledTimes(1));
    expect(privy.check).toHaveBeenCalledBefore(privy.link);
  });
});
