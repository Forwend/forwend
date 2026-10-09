import { API_BASE } from "@/constants/api";
import type { ActivityPage, Balances } from "@/types/app/money";
import type { Me, Profile, ProfileKind } from "@/types/app/profile";

/** An API answer other than 2xx; code is the API's error code (apps/backend/api/openapi.yaml, Error). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`API answered ${status} ${code}`);
  }
}

async function call<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw new ApiError(response.status, body?.error?.code ?? "unknown");
  }
  return (await response.json()) as T;
}

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

export function getBalances(accessToken: string, profileId: string): Promise<Balances> {
  return call(accessToken, `/v1/profiles/${encodeURIComponent(profileId)}/balances`);
}

export function getActivity(
  accessToken: string,
  profileId: string,
  limit: number,
  cursor?: string,
): Promise<ActivityPage> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set("cursor", cursor);
  return call(accessToken, `/v1/profiles/${encodeURIComponent(profileId)}/activity?${query}`);
}
