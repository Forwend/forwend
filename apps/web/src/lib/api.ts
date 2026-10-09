import { API_BASE } from "@/constants/api";
import type { Me } from "@/types/app/profile";

/** POST /v1/me: signs the user up on the first call, then returns their profiles (oldest first). */
export async function signUp(accessToken: string): Promise<Me> {
  const response = await fetch(`${API_BASE}/v1/me`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`POST /v1/me answered ${response.status}`);
  return (await response.json()) as Me;
}
