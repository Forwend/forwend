import type { BaseQueryApi, FetchBaseQueryMeta } from "@reduxjs/toolkit/query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_PAUSE_MS, nextPause, retryAfterMs, withRateLimit } from "@/shared/api/rate-limit";
import { REFRESH_MS } from "@/shared/config/refresh";

function answer(status: number, retryAfter?: string) {
  const headers = new Headers(retryAfter ? { "Retry-After": retryAfter } : {});
  const meta = {
    request: new Request("http://test"),
    response: new Response(null, { status, headers }),
  };
  return status === 200
    ? { data: {}, meta: meta as FetchBaseQueryMeta }
    : { error: { status, data: {} }, meta: meta as FetchBaseQueryMeta };
}

const api = (type: "query" | "mutation") =>
  ({ signal: new AbortController().signal, type }) as unknown as BaseQueryApi;

describe("retryAfterMs", () => {
  it("reads whole seconds, defaults to 1 s and stops at the cap", () => {
    expect(retryAfterMs("3")).toBe(3000);
    expect(retryAfterMs(null)).toBe(1000);
    expect(retryAfterMs("soon")).toBe(1000);
    expect(retryAfterMs("100000")).toBe(MAX_PAUSE_MS);
  });
});

describe("nextPause", () => {
  it("starts at the refresh interval and doubles up to the cap", () => {
    expect(nextPause(0)).toBe(REFRESH_MS);
    expect(nextPause(REFRESH_MS)).toBe(2 * REFRESH_MS);
    expect(nextPause(MAX_PAUSE_MS)).toBe(MAX_PAUSE_MS);
  });
});

describe("withRateLimit", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("waits Retry-After, then sends the request once more", async () => {
    const base = vi.fn().mockResolvedValueOnce(answer(429, "2")).mockResolvedValueOnce(answer(200));
    const result = withRateLimit(base)("/v1/me", api("query"), {});
    await vi.advanceTimersByTimeAsync(1999);
    expect(base).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).error).toBeUndefined();
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("hands a 429 straight back when the caller takes it as the answer", async () => {
    const base = vi.fn().mockResolvedValue(answer(429, "300"));
    const result = await withRateLimit(base)("/v1/invoices/x/recheck", api("mutation"), {
      answerFirst: true,
    });
    expect(result.error?.status).toBe(429);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("holds later reads for a pause that doubles while the retries are refused; a success ends it", async () => {
    const base = vi.fn().mockResolvedValue(answer(429, "1"));
    const query = withRateLimit(base);
    const sent = async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
      return base.mock.calls.length;
    };
    const first = query("/a", api("query"), {});
    expect(await sent(1000)).toBe(2);
    expect((await first).error?.status).toBe(429);

    const second = query("/a", api("query"), {});
    expect(await sent(REFRESH_MS - 1)).toBe(2);
    expect(await sent(1)).toBe(3);
    expect(await sent(1000)).toBe(4);
    await second;

    base.mockResolvedValue(answer(200));
    const third = query("/a", api("query"), {});
    expect(await sent(2 * REFRESH_MS - 1)).toBe(4);
    expect(await sent(1)).toBe(5);
    expect((await third).error).toBeUndefined();

    const fourth = query("/a", api("query"), {});
    expect(await sent(0)).toBe(6);
    await fourth;
  });

  it("never holds a mutation", async () => {
    const base = vi.fn().mockResolvedValue(answer(429, "1"));
    const query = withRateLimit(base);
    const refused = query("/a", api("query"), {});
    await vi.advanceTimersByTimeAsync(1000);
    await refused;
    base.mockResolvedValue(answer(200));
    expect((await query("/b", api("mutation"), {})).error).toBeUndefined();
  });
});
