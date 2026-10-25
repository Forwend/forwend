// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PERMISSIONS, PROFILE_KINDS, ROLES } from "@/features/profiles/constants/profile";
import { AppSessionContext } from "@/features/profiles/hooks/use-app-session";
import type { AppSession } from "@/features/profiles/types/app-session";
import { DevelopersScreen } from "@/screens/developers/developers-screen";

vi.mock("@/features/api-keys/components/api-keys", () => ({ ApiKeys: () => <section /> }));
vi.mock("@/features/webhooks/components/webhooks", () => ({ Webhooks: () => <section /> }));

afterEach(cleanup);

it("shows API keys and Webhooks without two children of the same key", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const profile = {
    profileId: "6f9619ff-8b86-4011-b42d-00c04fc964ff",
    kind: PROFILE_KINDS.merchant,
    name: "Shop",
    walletAddress: null,
    createdAt: "2026-10-20T10:00:00Z",
    role: ROLES.owner,
    permissions: [PERMISSIONS.keys, PERMISSIONS.webhooks],
  };
  const session = { profile, profiles: [profile] } as unknown as AppSession;
  const { container } = render(
    <AppSessionContext.Provider value={session}>
      <DevelopersScreen />
    </AppSessionContext.Provider>,
  );
  expect(container.querySelectorAll("section")).toHaveLength(2);
  expect(error.mock.calls.flat().join(" ")).not.toContain("same key");
  error.mockRestore();
});
