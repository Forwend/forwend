import { describe, expect, it } from "vitest";
import { endsAtOf, linkState } from "@/features/links/lib/links";
import type { Link } from "@/features/links/types/links";

const link: Link = {
  linkId: "aaaaaaaa-0000-4000-8000-000000000001",
  slug: "k3f9q2m7x1ab",
  title: "Logo design",
  storeId: null,
  amountUsd: "50.00",
  minUsd: null,
  maxUsd: null,
  endsAt: null,
  maxPayments: null,
  active: true,
  visits: 0,
  paid: 0,
  createdAt: "2026-10-25T00:00:00Z",
  updatedAt: "2026-10-25T00:00:00Z",
};
const NOW = Date.parse("2026-10-25T12:00:00Z");

// R-140: why a link takes no payments.
describe("payment links", () => {
  it("is off, then ended, then full, before it is on", () => {
    expect(linkState(link, NOW)).toBe("on");
    expect(linkState({ ...link, maxPayments: 2, paid: 2 }, NOW)).toBe("full");
    expect(
      linkState({ ...link, endsAt: endsAtOf("2026-10-24"), maxPayments: 2, paid: 2 }, NOW),
    ).toBe("ended");
    expect(linkState({ ...link, endsAt: endsAtOf("2026-10-25") }, NOW)).toBe("on");
    expect(linkState({ ...link, active: false, endsAt: endsAtOf("2026-10-24") }, NOW)).toBe("off");
  });
});
