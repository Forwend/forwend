import { describe, expect, it } from "vitest";
import { chosenProfile } from "@/features/profiles/chosen-profile";
import type { Profile } from "@/features/profiles/profile";

const personal: Profile = {
  profileId: "p-1",
  kind: "personal",
  name: null,
  walletAddress: null,
  createdAt: "2026-10-10T00:00:00Z",
};
const merchant: Profile = { ...personal, profileId: "p-2", kind: "merchant", name: "Shop" };

describe("chosenProfile", () => {
  it("opens the remembered profile", () => {
    expect(chosenProfile([personal, merchant], "p-2")).toBe(merchant);
  });

  it("opens the personal profile when nothing is remembered or the profile is gone", () => {
    expect(chosenProfile([personal, merchant], null)).toBe(personal);
    expect(chosenProfile([personal, merchant], "p-9")).toBe(personal);
  });
});
