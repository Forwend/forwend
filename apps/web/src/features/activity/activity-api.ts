import type { ActivityPage } from "@/features/activity/activity";
import { call } from "@/shared/api/client";

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
