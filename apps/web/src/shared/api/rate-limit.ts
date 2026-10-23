import type {
  BaseQueryFn,
  FetchArgs,
  FetchBaseQueryError,
  FetchBaseQueryMeta,
} from "@reduxjs/toolkit/query";
import { REFRESH_MS } from "@/shared/config/refresh";

/** `answerFirst`: a 429 is the answer itself (Check status asked too soon), not something to wait out. */
export interface RateLimitOptions {
  answerFirst?: boolean;
}

type BaseQuery = BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError,
  RateLimitOptions,
  FetchBaseQueryMeta
>;

export const MAX_PAUSE_MS = 5 * 60_000;

export function retryAfterMs(header: string | null | undefined): number {
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_PAUSE_MS) : 1000;
}

export function nextPause(pauseMs: number): number {
  return Math.min(Math.max(pauseMs * 2, REFRESH_MS), MAX_PAUSE_MS);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });
}

/** A 429 waits Retry-After and is sent once more; if refused again, later reads wait a pause that doubles per
 * refusal until an answer that is not a 429. Mutations never wait for the pause. */
export function withRateLimit(base: BaseQuery): BaseQuery {
  let pauseMs = 0;
  let pausedUntil = 0;
  return async (args, api, extra) => {
    if (api.type === "query") await sleep(pausedUntil - Date.now(), api.signal);
    let result = await base(args, api, extra);
    if (result.error?.status === 429 && extra?.answerFirst) return result;
    if (result.error?.status === 429) {
      await sleep(retryAfterMs(result.meta?.response?.headers.get("Retry-After")), api.signal);
      result = await base(args, api, extra);
    }
    if (result.error?.status === 429) {
      pauseMs = nextPause(pauseMs);
      pausedUntil = Date.now() + pauseMs;
    } else {
      pauseMs = 0;
      pausedUntil = 0;
    }
    return result;
  };
}
