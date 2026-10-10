import type {
  BaseQueryFn,
  FetchArgs,
  FetchBaseQueryError,
  FetchBaseQueryMeta,
} from "@reduxjs/toolkit/query";
import { REFRESH_MS } from "@/shared/config/refresh";

type BaseQuery = BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError,
  object,
  FetchBaseQueryMeta
>;

export const MAX_PAUSE_MS = 5 * 60_000;

/** The wait a 429's Retry-After header asks for (whole seconds), in ms: 1 s when it is missing or not a number,
 * at most MAX_PAUSE_MS. */
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

/** Wraps the base query so a 429 does not turn into more load. The request waits Retry-After and is sent once more.
 * When that is refused too, every later read first waits a pause that doubles with each refusal, so polling slows
 * down from every 15 s; the first answer that is not a 429 ends the pause. Mutations never wait for the pause. */
export function withRateLimit(base: BaseQuery): BaseQuery {
  let pauseMs = 0;
  let pausedUntil = 0;
  return async (args, api, extra) => {
    if (api.type === "query") await sleep(pausedUntil - Date.now(), api.signal);
    let result = await base(args, api, extra);
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
