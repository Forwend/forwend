import { afterEach, describe, expect, it, vi } from "vitest";
import { profilesApi } from "@/features/profiles/api/profiles-api";
import type { Me, Profile } from "@/features/profiles/types/profile";
import { makeStore } from "@/store/store";

const personal: Profile = {
  profileId: "11111111-1111-1111-1111-111111111111",
  kind: "personal",
  name: null,
  walletAddress: "0x1111111111111111111111111111111111111111",
  createdAt: "2026-10-10T00:00:00Z",
  role: "owner",
  permissions: ["invoices.read", "money.read"],
  livemode: false,
};
const merchant: Profile = {
  ...personal,
  profileId: "22222222-2222-2222-2222-222222222222",
  kind: "merchant",
  name: "Shop",
};

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
    expect(profilesApi.endpoints.signUp.select()(store.getState()).data?.profiles).toEqual([
      personal,
      merchant,
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reads again what the other mode read once Developer mode turns, and keeps the profiles (R-221)", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        answer({ onboardedAt: null, profiles: [personal, merchant] } satisfies Me),
      )
      .mockResolvedValueOnce(answer({ email: true, address: null }))
      .mockResolvedValueOnce(answer({ livemode: true }))
      .mockResolvedValueOnce(answer({ email: false, address: null }));
    const store = makeStore({ getAccessToken: async () => "token-1" });
    await store.dispatch(profilesApi.endpoints.signUp.initiate());
    await store.dispatch(profilesApi.endpoints.getNotifications.initiate(merchant.profileId));

    await store
      .dispatch(
        profilesApi.endpoints.saveProfileMode.initiate({
          profileId: merchant.profileId,
          livemode: true,
        }),
      )
      .unwrap();
    const put = fetch.mock.calls[2]?.[0] as Request;
    expect([put.method, new URL(put.url).pathname]).toEqual([
      "PUT",
      `/api/v1/profiles/${merchant.profileId}/mode`,
    ]);
    await vi.waitFor(() =>
      expect(
        profilesApi.endpoints.signUp
          .select()(store.getState())
          .data?.profiles.map((p) => p.livemode),
      ).toEqual([false, true]),
    );
    await vi.waitFor(() =>
      expect(
        profilesApi.endpoints.getNotifications.select(merchant.profileId)(store.getState()).data
          ?.email,
      ).toBe(false),
    );
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
