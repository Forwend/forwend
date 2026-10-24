import type { BaseQueryApi } from "@reduxjs/toolkit/query";
import { describe, expect, it, vi } from "vitest";
import { REAUTH_REQUIRED, withFreshSignIn } from "@/shared/api/fresh-sign-in";

const reauth = { error: { status: 401, data: { error: { code: REAUTH_REQUIRED, message: "" } } } };
const unauthorized = {
  error: { status: 401, data: { error: { code: "unauthorized", message: "" } } },
};
const ok = { data: { saved: true } };
const api = (freshSignIn?: () => Promise<boolean>) =>
  ({
    signal: new AbortController().signal,
    type: "mutation",
    extra: { freshSignIn },
  }) as unknown as BaseQueryApi;
const wrap = (base: ReturnType<typeof vi.fn>) =>
  withFreshSignIn(
    base as unknown as Parameters<typeof withFreshSignIn>[0],
    (extra) => (extra as { freshSignIn?: () => Promise<boolean> }).freshSignIn,
  );

// R-137: a change that needs a fresh sign-in is sent again only after the user signed in again.
describe("withFreshSignIn", () => {
  it("asks for a sign-in on reauth_required, then sends the request once more", async () => {
    const base = vi.fn().mockResolvedValueOnce(reauth).mockResolvedValueOnce(ok);
    const ask = vi.fn().mockResolvedValue(true);
    expect(await wrap(base)("/v1/x", api(ask), {})).toEqual(ok);
    expect([ask.mock.calls.length, base.mock.calls.length]).toEqual([1, 2]);
  });

  it("asks once per request: a second reauth_required after the sign-in is the answer", async () => {
    const base = vi.fn().mockResolvedValue(reauth);
    const ask = vi.fn().mockResolvedValue(true);
    expect(await wrap(base)("/v1/x", api(ask), {})).toEqual(reauth);
    expect([ask.mock.calls.length, base.mock.calls.length]).toEqual([1, 2]);
  });

  it("sends nothing more when the user cancels", async () => {
    const base = vi.fn().mockResolvedValue(reauth);
    expect(
      await wrap(base)(
        "/v1/x",
        api(async () => false),
        {},
      ),
    ).toEqual(reauth);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("leaves other 401s and pages without a sign-in alone", async () => {
    const base = vi.fn().mockResolvedValueOnce(unauthorized).mockResolvedValueOnce(reauth);
    const ask = vi.fn().mockResolvedValue(true);
    expect(await wrap(base)("/v1/x", api(ask), {})).toEqual(unauthorized);
    expect(await wrap(base)("/v1/x", api(), {})).toEqual(reauth);
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks once for requests that need it together", async () => {
    const base = vi
      .fn()
      .mockResolvedValueOnce(reauth)
      .mockResolvedValueOnce(reauth)
      .mockResolvedValue(ok);
    let sign: (ok: boolean) => void = () => {};
    const ask = vi.fn(() => new Promise<boolean>((resolve) => (sign = resolve)));
    const wrapped = wrap(base);
    const both = Promise.all([wrapped("/v1/a", api(ask), {}), wrapped("/v1/b", api(ask), {})]);
    await vi.waitFor(() => expect(base).toHaveBeenCalledTimes(2));
    sign(true);
    expect(await both).toEqual([ok, ok]);
    expect(ask).toHaveBeenCalledTimes(1);
  });
});
