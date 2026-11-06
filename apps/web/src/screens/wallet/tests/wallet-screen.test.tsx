// @vitest-environment jsdom
import { ToastProvider } from "@forwend/ui-web";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WalletScreen } from "@/screens/wallet/wallet-screen";

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

const ADDRESS = "0x4edd1111111111111111111111111111111181fc";
const calls = vi.hoisted(() => ({
  address: "0x4edd1111111111111111111111111111111181fc" as string | null,
  check: vi.fn(async () => {}),
  exportWallet: vi.fn(async (_: { address: string }) => {}),
}));
vi.mock("@privy-io/react-auth", () => ({
  useExportWallet: () => ({ exportWallet: calls.exportWallet }),
}));
vi.mock("@/features/auth/api/auth-api", () => ({
  useCheckFreshSignInMutation: () => [() => ({ unwrap: calls.check })],
}));
vi.mock("@/features/profiles/hooks/use-app-session", () => ({
  useAppSession: () => ({ profile: { profileId: "p1", walletAddress: calls.address } }),
}));

const wrap = ({ children }: { children: ReactNode }) => <ToastProvider>{children}</ToastProvider>;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  calls.address = ADDRESS;
});

describe("the Wallet page (R-218)", () => {
  it("shows the address, and opens Privy's export for it only after the warning and the api's check", async () => {
    render(<WalletScreen />, { wrapper: wrap });
    expect(screen.getByText(/^0x4edd/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Export private key" }));
    const dialog = screen.getByRole("dialog", { name: "Export this wallet's private key?" });
    expect(dialog.textContent).toContain(
      "Anyone with this key controls this wallet and its money.",
    );
    expect(calls.exportWallet).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Show the key" }));
    await waitFor(() => expect(calls.exportWallet).toHaveBeenCalledWith({ address: ADDRESS }));
    expect(calls.check).toHaveBeenCalledBefore(calls.exportWallet);
    // The warning closes, so no dialog sits under Privy's.
    expect(dialog.hasAttribute("open")).toBe(false);
  });

  it("opens nothing when the api can't say the session is fresh", async () => {
    calls.check.mockRejectedValueOnce({ status: 500 });
    render(<WalletScreen />, { wrapper: wrap });
    fireEvent.click(screen.getByRole("button", { name: "Export private key" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Show the key" }),
    );
    expect(await screen.findByText("The export page didn't open. Try again.")).toBeTruthy();
    expect(calls.exportWallet).not.toHaveBeenCalled();
  });

  it("says so where it can be seen when Privy's window fails to open, after the warning closed", async () => {
    calls.exportWallet.mockRejectedValueOnce(new Error("Wallet not ready for export"));
    render(<WalletScreen />, { wrapper: wrap });
    fireEvent.click(screen.getByRole("button", { name: "Export private key" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Show the key" }));
    expect(await screen.findByText("The export page didn't open. Try again.")).toBeTruthy();
    expect(dialog.hasAttribute("open")).toBe(false);
  });

  it("lets the owner open the export again while Privy hasn't settled the last one", async () => {
    calls.exportWallet.mockReturnValueOnce(new Promise(() => {}));
    render(<WalletScreen />, { wrapper: wrap });
    fireEvent.click(screen.getByRole("button", { name: "Export private key" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Show the key" }));
    await waitFor(() => expect(calls.exportWallet).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Export private key" }));
    const show = within(dialog).getByRole("button", { name: "Show the key" });
    expect(show.getAttribute("aria-busy")).toBeNull();
    fireEvent.click(show);
    await waitFor(() => expect(calls.exportWallet).toHaveBeenCalledTimes(2));
  });

  it("says so when the profile has no wallet yet", () => {
    calls.address = null;
    render(<WalletScreen />, { wrapper: wrap });
    expect(screen.getByText("This profile's wallet isn't ready yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Export private key" })).toBeNull();
  });
});
