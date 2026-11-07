// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useWalletMfa } from "@/features/auth/hooks/use-wallet-mfa";

const privy = vi.hoisted(() => ({ methods: [] as string[] }));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ user: { mfaMethods: privy.methods } }),
  useMfa: () => ({ promptMfa: vi.fn(), clear: vi.fn() }),
}));

afterEach(() => vi.unstubAllEnvs());

// R-219: money moves once both a passkey and an authenticator app are on, so one lost still confirms and removes the
// other; one alone isn't enough.
it("needs both methods before money moves, where two-step is required", () => {
  vi.stubEnv("NEXT_PUBLIC_WALLET_MFA", "1");
  privy.methods = ["passkey"];
  expect(renderHook(() => useWalletMfa()).result.current.needed).toBe(true);
  privy.methods = ["totp"];
  expect(renderHook(() => useWalletMfa()).result.current.needed).toBe(true);
  privy.methods = ["passkey", "totp"];
  expect(renderHook(() => useWalletMfa()).result.current.needed).toBe(false);
  vi.stubEnv("NEXT_PUBLIC_WALLET_MFA", "0");
  privy.methods = [];
  expect(renderHook(() => useWalletMfa()).result.current.needed).toBe(false);
});
