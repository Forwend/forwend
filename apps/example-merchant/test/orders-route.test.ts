import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn(async (_body: object) => ({
  sessionId: "0xa",
  payment: { payToken: "a".repeat(64) },
}));
vi.mock("@/lib/forwend", () => ({
  forwend: () => ({ checkoutSessions: { create } }),
  storeId: () => "store",
  trustedIpHeader: () => process.env.TRUST_PROXY_HEADER || undefined,
}));
vi.mock("@/lib/orders", () => ({ orders: () => ({ create: () => {}, attach: () => {} }) }));

const order = async (ip?: string) => {
  const { POST } = await import("@/app/api/orders/route");
  return POST(
    new Request("http://shop.test/api/orders", {
      method: "POST",
      headers: ip ? { "X-Real-IP": ip } : {},
      body: JSON.stringify({ lines: [{ id: "mug", quantity: 1 }] }),
    }),
  );
};

describe("POST /api/orders", () => {
  beforeEach(() => {
    vi.resetModules();
    create.mockClear();
  });

  it("makes short checkouts and refuses past the shop's limit with Retry-After, so visitors can't use up the quota", async () => {
    for (let i = 0; i < 20; i++) expect((await order()).status).toBe(201);
    const refused = await order();
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(create).toHaveBeenCalledTimes(20);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ expiresIn: 900 });
  });

  it("limits each visitor behind the trusted proxy, and the shop's refusal costs the visitor nothing", async () => {
    vi.stubEnv("TRUST_PROXY_HEADER", "X-Real-IP");
    vi.useFakeTimers({ now: 0, toFake: ["Date"] });
    for (let i = 0; i < 5; i++) expect((await order("1.1.1.1")).status).toBe(201);
    expect((await order("1.1.1.1")).status).toBe(429);
    for (let i = 0; i < 15; i++) expect((await order(`2.2.2.${i}`)).status).toBe(201);
    // The shop is full; this visitor is refused by it, not by their own count.
    vi.setSystemTime(9 * 60_000);
    for (let i = 0; i < 5; i++) expect((await order("3.3.3.3")).status).toBe(429);
    // The shop's window ends first: the visitor still has all five.
    vi.setSystemTime(10 * 60_000 + 1);
    for (let i = 0; i < 5; i++) expect((await order("3.3.3.3")).status).toBe(201);
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });
});
