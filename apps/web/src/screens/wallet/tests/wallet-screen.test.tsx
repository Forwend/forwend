// @vitest-environment jsdom
import { ToastProvider } from "@forwend/ui-web";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WalletScreen } from "@/screens/wallet/wallet-screen";

const ADDRESS = "0x4edd1111111111111111111111111111111181fc";
const calls = vi.hoisted(() => ({
  check: vi.fn(async () => {}),
  exportWallet: vi.fn(async (_: { address: string }) => {}),
  mfa: { needed: false, enrolled: false },
}));
vi.mock("@/features/auth/hooks/use-wallet-mfa", () => ({ useWalletMfa: () => calls.mfa }));
vi.mock("@privy-io/react-auth", () => ({
  useExportWallet: () => ({ exportWallet: calls.exportWallet }),
}));
vi.mock("@/features/auth/hooks/use-mfa-step", () => ({
  useMfaStep: () => ({
    run: (action: () => unknown) => action(),
    step: null,
    cancel: vi.fn(),
  }),
}));
vi.mock("@/features/auth/components/two-step-setup", () => ({
  TwoStepSetup: () => <p>two-step setup</p>,
}));
vi.mock("@/features/auth/api/auth-api", () => ({
  useCheckFreshSignInMutation: () => [() => ({ unwrap: calls.check })],
}));
vi.mock("@/features/profiles/hooks/use-app-session", () => ({
  useAppSession: () => ({ profile: { profileId: "p1", walletAddress: ADDRESS } }),
}));

const wrap = ({ children }: { children: ReactNode }) => <ToastProvider>{children}</ToastProvider>;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  calls.mfa.needed = false;
  calls.mfa.enrolled = false;
});

describe("the Wallet page", () => {
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

  it("sets up two-step in place of Show the key until it is set up", () => {
    calls.mfa.needed = true;
    render(<WalletScreen />, { wrapper: wrap });
    fireEvent.click(screen.getByRole("button", { name: "Export private key" }));
    const dialog = screen.getByRole("dialog", { name: "Export this wallet's private key?" });
    expect(within(dialog).queryByRole("button", { name: "Show the key" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Set up two-step verification" }));
    expect(within(dialog).getByText("two-step setup")).toBeTruthy();
    expect(calls.check).not.toHaveBeenCalled();
    expect(calls.exportWallet).not.toHaveBeenCalled();
  });

  it("opens Privy's export without Forwend's emailed code once two-step is set up", async () => {
    calls.mfa.enrolled = true;
    render(<WalletScreen />, { wrapper: wrap });
    fireEvent.click(screen.getByRole("button", { name: "Export private key" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Show the key" }),
    );
    await waitFor(() => expect(calls.exportWallet).toHaveBeenCalledWith({ address: ADDRESS }));
    expect(calls.check).not.toHaveBeenCalled();
  });
});
