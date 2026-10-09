import type { Me, Profile, ProfileKind } from "@/features/profiles/profile";
import { call } from "@/shared/api/client";

/** POST /v1/me: signs the user up on the first call, then returns their profiles (oldest first). */
export function signUp(accessToken: string): Promise<Me> {
  return call(accessToken, "/v1/me", { method: "POST" });
}

/** POST /v1/profiles: one profile per idempotency key, so a retried request never makes two. */
export function createProfile(
  accessToken: string,
  idempotencyKey: string,
  body: { kind: ProfileKind; name: string },
): Promise<Profile> {
  return call(accessToken, "/v1/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(body),
  });
}
