// @vitest-environment jsdom
import { ToastProvider } from "@forwend/ui-web";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const signal = vi.fn(async (_: { rpId: string; credentialId: string }) => {});
vi.stubGlobal("PublicKeyCredential", { signalUnknownCredential: signal });

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
    fireEvent.click(
      screen.getByRole("button", { name: "Remove iCloud Keychain made on Safari, macOS" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Remove this passkey?" });
    expect(privy.unlink).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(privy.unlink).toHaveBeenCalledWith("cred-1"));
    expect(privy.check).toHaveBeenCalledBefore(privy.unlink);
    // The password manager drops it too, so sign-in stops offering it.
    await waitFor(() =>
      expect(signal).toHaveBeenCalledWith({ rpId: location.hostname, credentialId: "cred-1" }),
    );
  });

  it("leaves the passkey when the api can't say the session is fresh", async () => {
    privy.accounts = [email, passkey];
    privy.check.mockRejectedValueOnce({ status: 500 });
    render(<Passkeys />, { wrapper: wrap });
    fireEvent.click(
      screen.getByRole("button", { name: "Remove iCloud Keychain made on Safari, macOS" }),
    );
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("The passkey was not removed. Try again.")).toBeTruthy();
    expect(privy.unlink).not.toHaveBeenCalled();
  });

  it("keeps the only way to sign in, and says why", () => {
    privy.accounts = [passkey];
    render(<Passkeys />, { wrapper: wrap });
    expect(
      (
        screen.getByRole("button", {
          name: "Remove iCloud Keychain made on Safari, macOS",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    const reason = screen.getByText("It's your only way to sign in. Add another first.");
    expect(
      screen
        .getByRole("button", { name: "Remove iCloud Keychain made on Safari, macOS" })
        .getAttribute("aria-describedby"),
    ).toBe(reason.id);
  });

  // R-219: Privy keeps two-step on with nothing to answer it when its passkey is unlinked, which locks the owner out.
  it("keeps the passkey that is two-step's, and says why", () => {
    privy.accounts = [email, { ...passkey, enrolledInMfa: true }];
    render(<Passkeys />, { wrapper: wrap });
    const remove = screen.getByRole("button", {
      name: "Remove iCloud Keychain made on Safari, macOS",
    }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    const reason = screen.getByText(
      "It's your two-step verification. Remove it from two-step first.",
    );
    expect(remove.getAttribute("aria-describedby")).toBe(reason.id);
    expect(screen.getByText("Two-step")).toBeTruthy();
  });

  it("names each Remove apart, by where a passkey with no name was made", () => {
    const { authenticatorName: _, ...unnamed } = passkey;
    privy.accounts = [
      email,
      { ...unnamed, credentialId: "a", createdWithBrowser: "Chrome", createdWithOs: "Windows" },
      { ...unnamed, credentialId: "b" },
    ];
    render(<Passkeys />, { wrapper: wrap });
    expect(
      screen.getByRole("button", { name: "Remove Passkey made on Chrome, Windows" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Remove Passkey made on Safari, macOS" }),
    ).toBeTruthy();
  });

  it("moves the focus to Add a passkey once a passkey is removed", async () => {
    privy.accounts = [email, passkey];
    const { rerender } = render(<Passkeys />, { wrapper: wrap });
    fireEvent.click(
      screen.getByRole("button", { name: "Remove iCloud Keychain made on Safari, macOS" }),
    );
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(privy.unlink).toHaveBeenCalled());
    privy.accounts = [email];
    rerender(<Passkeys />);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add a passkey" })),
    );
  });

  it("clears a removal's error when its dialog closes", async () => {
    privy.accounts = [email, passkey];
    privy.check.mockRejectedValueOnce({ status: 500 });
    render(<Passkeys />, { wrapper: wrap });
    const open = screen.getByRole("button", {
      name: "Remove iCloud Keychain made on Safari, macOS",
    });
    fireEvent.click(open);
    const dialog = screen.getByRole("dialog", { name: "Remove this passkey?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await within(dialog).findByText("The passkey was not removed. Try again.");
    // Keep it closes the dialog as the browser does for its form.
    act(() => (dialog as HTMLDialogElement).close());
    fireEvent.click(open);
    expect(within(dialog).queryByText("The passkey was not removed. Try again.")).toBeNull();
  });

  it("says so when adding a passkey fails", async () => {
    privy.accounts = [email, passkey];
    privy.link.mockRejectedValueOnce(new Error("the browser refused"));
    render(<Passkeys />, { wrapper: wrap });
    fireEvent.click(screen.getByRole("button", { name: "Add a passkey" }));
    expect(await screen.findByText("The passkey was not added. Try again.")).toBeTruthy();
  });

  it("counts Google as a way to sign in, so a passkey beside it can go", () => {
    privy.accounts = [{ type: "google_oauth", email: "owner@gmail.com" }, passkey];
    render(<Passkeys />, { wrapper: wrap });
    expect(
      (
        screen.getByRole("button", {
          name: "Remove iCloud Keychain made on Safari, macOS",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("adds another passkey once the api says the session is fresh", async () => {
    privy.accounts = [email, passkey];
    render(<Passkeys />, { wrapper: wrap });
    fireEvent.click(screen.getByRole("button", { name: "Add a passkey" }));
    await waitFor(() => expect(privy.link).toHaveBeenCalledTimes(1));
    expect(privy.check).toHaveBeenCalledBefore(privy.link);
  });
});
