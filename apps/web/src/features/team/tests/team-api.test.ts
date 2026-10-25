import { afterEach, describe, expect, it, vi } from "vitest";
import { profilesApi } from "@/features/profiles/api/profiles-api";
import type { Profile } from "@/features/profiles/types/profile";
import { teamApi } from "@/features/team/api/team-api";
import { makeStore } from "@/store/store";

const MEMBER = "77777777-7777-4777-8777-777777777777";
const shop = (role: Profile["role"], permissions: string[]): Profile => ({
  profileId: "22222222-2222-2222-2222-222222222222",
  kind: "merchant",
  name: "Shop",
  walletAddress: null,
  createdAt: "2026-10-10T00:00:00Z",
  role,
  permissions,
});

// The app calls the API same-origin ("/api/…"); Node's Request needs an absolute URL.
const NodeRequest = globalThis.Request;
vi.stubGlobal(
  "Request",
  class extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, "http://localhost") : input, init);
    }
  },
);

const answer = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

afterEach(() => vi.restoreAllMocks());

// D-93: an Admin who changes or removes themselves sees only what is left, without a reload.
describe("team API", () => {
  it("reads the user's profiles again after a role change", async () => {
    const before = shop("admin", ["invoices.read", "team", "team.leave"]);
    const after = shop("developer", ["invoices.read", "team.leave"]);
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(answer({ onboardedAt: null, profiles: [before] }))
      .mockResolvedValueOnce(
        answer({
          memberId: MEMBER,
          email: null,
          role: "developer",
          stores: [MEMBER],
          createdAt: before.createdAt,
        }),
      )
      .mockResolvedValueOnce(answer({ onboardedAt: null, profiles: [after] }));
    const store = makeStore({ getAccessToken: async () => "token-1" });
    await store.dispatch(profilesApi.endpoints.signUp.initiate());

    await store
      .dispatch(
        teamApi.endpoints.setMember.initiate({
          profileId: before.profileId,
          memberId: MEMBER,
          body: { role: "developer", stores: [MEMBER] },
        }),
      )
      .unwrap();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    const meAgain = fetch.mock.calls[2]?.[0] as Request | undefined;
    expect(meAgain?.url).toMatch(/\/v1\/me$/);
    await vi.waitFor(() =>
      expect(profilesApi.endpoints.signUp.select()(store.getState()).data?.profiles).toEqual([
        after,
      ]),
    );
  });
});
