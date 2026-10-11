import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me, Profile } from "@/features/profiles/profile";
import { profilesApi } from "@/features/profiles/profiles-api";
import { makeStore } from "@/store/store";

const personal: Profile = {
  profileId: "p-1",
  kind: "personal",
  name: null,
  walletAddress: "0x1111111111111111111111111111111111111111",
  createdAt: "2026-10-10T00:00:00Z",
};
const merchant: Profile = { ...personal, profileId: "p-2", kind: "merchant", name: "Shop" };

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

function answer(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

afterEach(() => vi.restoreAllMocks());

describe("profiles API", () => {
  it("sends the access token and adds a created profile to the cached list", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(answer({ onboardedAt: null, profiles: [personal] } satisfies Me))
      .mockResolvedValueOnce(answer(merchant));
    const store = makeStore({ getAccessToken: async () => "token-1" });

    await store.dispatch(profilesApi.endpoints.signUp.initiate());
    const request = fetch.mock.calls[0]?.[0] as Request;
    expect(request.headers.get("Authorization")).toBe("Bearer token-1");

    await store
      .dispatch(
        profilesApi.endpoints.createProfile.initiate({
          idempotencyKey: "k-1",
          body: { kind: "merchant", name: "Shop" },
        }),
      )
      .unwrap();
    const create = fetch.mock.calls[1]?.[0] as Request;
    expect(create.headers.get("Idempotency-Key")).toBe("k-1");
    // The list now has both, and no second POST /v1/me was made.
    expect(profilesApi.endpoints.signUp.select()(store.getState()).data?.profiles).toEqual([
      personal,
      merchant,
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
