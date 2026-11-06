import { describe, expect, it } from "vitest";
import type { Profile } from "@/features/profiles/types/profile";
import { settingsSections } from "@/screens/settings/lib/settings-sections";
import { APP_ROUTES } from "@/shared/config/routes";

const profile = (role: string, permissions: string[]): Profile =>
  ({
    profileId: "22222222-2222-2222-2222-222222222222",
    kind: "merchant",
    name: "Shop",
    walletAddress: "0x1111111111111111111111111111111111111111",
    createdAt: "2026-10-10T00:00:00Z",
    role,
    permissions,
  }) as Profile;
const hrefs = (p: Profile) => settingsSections(p).flatMap((s) => s.items.map((i) => i.href));

describe("the Wallet section (R-218, D-61)", () => {
  it("shows to the owner, who alone moves money", () => {
    expect(hrefs(profile("owner", ["money.move", "tokens.read", "team.leave"]))).toContain(
      APP_ROUTES.wallet,
    );
  });

  it("never shows to a team member, an Admin included", () => {
    expect(hrefs(profile("admin", ["tokens.read", "team.manage", "team.leave"]))).not.toContain(
      APP_ROUTES.wallet,
    );
  });
});
