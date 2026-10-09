import { API_BASE } from "@/shared/config/api";

/** An API answer other than 2xx; code is the API's error code (apps/backend/api/openapi.yaml, Error). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`API answered ${status} ${code}`);
  }
}

export async function call<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
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
