import type { Balances } from "@/features/balances/balances";
import { call } from "@/shared/api/client";

export function getBalances(accessToken: string, profileId: string): Promise<Balances> {
  return call(accessToken, `/v1/profiles/${encodeURIComponent(profileId)}/balances`);
}
