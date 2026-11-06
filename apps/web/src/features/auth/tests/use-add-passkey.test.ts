// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAddPasskey } from "@/features/auth/hooks/use-add-passkey";

const calls = vi.hoisted(() => ({
  check: vi.fn(async () => {}),
  link: vi.fn(async () => {}),
}));
vi.mock("@privy-io/react-auth", () => ({
  useLinkWithPasskey: () => ({ linkWithPasskey: calls.link }),
}));
vi.mock("@/features/auth/api/auth-api", () => ({
  useCheckFreshSignInMutation: () => [() => ({ unwrap: calls.check })],
}));

afterEach(() => vi.clearAllMocks());

describe("adding a passkey (R-217)", () => {
  it("asks the api first, so a stale session confirms it's you before Privy links one", async () => {
    const { result } = renderHook(() => useAddPasskey());
    await result.current();
    expect(calls.check).toHaveBeenCalledBefore(calls.link);
  });

  it("links nothing when the check is refused", async () => {
    calls.check.mockRejectedValueOnce({
      status: 401,
      data: { error: { code: "reauth_required" } },
    });
    const { result } = renderHook(() => useAddPasskey());
    await expect(result.current()).rejects.toBeTruthy();
    expect(calls.link).not.toHaveBeenCalled();
  });
});
