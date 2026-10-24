// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { useStore } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { profilesApi } from "@/features/profiles/api/profiles-api";
import { StoreProvider } from "@/providers/store-provider";
import type { AppStore } from "@/store/store";

const privy = vi.hoisted(() => ({ user: { id: "did:privy:a" } as { id: string } | null }));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ user: privy.user, getAccessToken: async () => "token" }),
  // The fresh sign-in dialog the provider mounts (R-137); it stays closed here.
  useLoginWithEmail: () => ({ sendCode: async () => {}, loginWithCode: async () => {} }),
}));

let seen: AppStore | null = null;
function Probe() {
  seen = useStore() as AppStore;
  return null;
}

function cachedProfiles() {
  if (!seen) throw new Error("no store");
  return profilesApi.endpoints.signUp.select()(seen.getState()).data;
}

afterEach(cleanup);

describe("StoreProvider", () => {
  it("never shows one user's cached answers to the next user in the same tab", async () => {
    const { rerender } = render(
      <StoreProvider>
        <Probe />
      </StoreProvider>,
    );
    await seen?.dispatch(
      profilesApi.util.upsertQueryData("signUp", undefined, { onboardedAt: null, profiles: [] }),
    );
    expect(cachedProfiles()).toBeDefined();

    // A's session ends without the Sign out button, then B signs in.
    privy.user = null;
    rerender(
      <StoreProvider>
        <Probe />
      </StoreProvider>,
    );
    privy.user = { id: "did:privy:b" };
    rerender(
      <StoreProvider>
        <Probe />
      </StoreProvider>,
    );
    expect(cachedProfiles()).toBeUndefined();
  });
});
