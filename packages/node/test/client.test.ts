import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Forwend, ForwendError } from "../src/index.js";

const PROFILE = "6f9619ff-8b86-4011-b42d-00c04fc964ff";
const KEY = `fw_test_${"a".repeat(36)}`;

/** A fetch that answers from a list and keeps each request. */
function fake(answers: Array<{ status?: number; json: unknown }>) {
  const requests: Request[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    requests.push(new Request(input, init));
    const next = answers.shift();
    if (!next) throw new Error("no answer left");
    return Response.json(next.json, { status: next.status ?? 200 });
  };
  const client = new Forwend({
    apiKey: KEY,
    profileId: PROFILE,
    baseUrl: "https://api.example.com",
    fetch,
  });
  return { client, requests };
}

describe("Forwend", () => {
  it("creates, reads and expires checkout while reading canonical payments without invoice numbers", async () => {
    const payment = { paymentId: "0xa", number: null, paymentStatus: "open" };
    const session = { sessionId: "0xa", status: "open", payment };
    const { client, requests } = fake([
      { status: 201, json: session },
      { json: session },
      { json: payment },
      { json: { items: [session], nextCursor: null } },
      { json: { items: [payment], nextCursor: "next" } },
      { json: { items: [], nextCursor: null } },
      { json: { ...session, status: "expired" } },
    ]);
    const body = { storeId: PROFILE, amountUsd: "12.50", reference: "order-42" };
    expect(await client.checkoutSessions.create(body, { idempotencyKey: "purchase-42" })).toEqual(
      session,
    );
    expect(await client.checkoutSessions.get("0xa")).toEqual(session);
    expect(await client.payments.get("0xa")).toEqual(payment);
    const sessions = [];
    for await (const item of client.checkoutSessions.list({ storeId: PROFILE }))
      sessions.push(item);
    expect(sessions).toEqual([session]);
    const payments = [];
    for await (const item of client.payments.list({ storeId: PROFILE })) payments.push(item);
    expect(payments).toEqual([payment]);
    expect((await client.checkoutSessions.expire("0xa")).status).toBe("expired");
    expect(
      requests.map((r) => r.url.replace(`https://api.example.com/v1/profiles/${PROFILE}`, "")),
    ).toEqual([
      "/checkout-sessions",
      "/checkout-sessions/0xa",
      "/payments/0xa",
      `/checkout-sessions?storeId=${PROFILE}`,
      `/payments?storeId=${PROFILE}`,
      `/payments?storeId=${PROFILE}&cursor=next`,
      "/checkout-sessions/0xa/expire",
    ]);
    expect(requests[0]?.headers.get("Idempotency-Key")).toBe("purchase-42");
    expect(await requests[0]?.json()).toEqual(body);
    expect(requests[6]?.method).toBe("POST");
  });
  it("creates an invoice with the key and an Idempotency-Key, made when none is given", async () => {
    const { client, requests } = fake([
      { status: 201, json: { invoiceId: "0xa" } },
      { status: 201, json: { invoiceId: "0xb" } },
    ]);
    const body = {
      chainId: 84532,
      token: "0xusdc",
      amount: "5000000",
      metadata: { order_id: "A-1" },
    };
    expect(await client.invoices.create(body, { idempotencyKey: "order-A-1" })).toEqual({
      invoiceId: "0xa",
    });
    await client.invoices.create(body);
    const [first, second] = requests;
    expect(first?.method).toBe("POST");
    expect(first?.url).toBe(`https://api.example.com/v1/profiles/${PROFILE}/invoices`);
    expect(first?.headers.get("Authorization")).toBe(`Bearer ${KEY}`);
    expect(first?.headers.get("Idempotency-Key")).toBe("order-A-1");
    expect(await first?.json()).toEqual(body);
    expect(second?.headers.get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("gets an invoice, and lists every page through nextCursor", async () => {
    const { client, requests } = fake([
      { json: { invoiceId: "0xa", number: 1 } },
      { json: { items: [{ invoiceId: "0x3" }, { invoiceId: "0x2" }], nextCursor: "2" } },
      { json: { items: [{ invoiceId: "0x1" }], nextCursor: null } },
    ]);
    expect(await client.invoices.get("0xa")).toEqual({ invoiceId: "0xa", number: 1 });
    const ids: unknown[] = [];
    for await (const invoice of client.invoices.list({ limit: 2, status: "paid", q: "INV-0042" })) {
      ids.push(invoice.invoiceId);
    }
    expect(ids).toEqual(["0x3", "0x2", "0x1"]);
    expect(requests.map((r) => r.url)).toEqual([
      `https://api.example.com/v1/profiles/${PROFILE}/invoices/0xa`,
      `https://api.example.com/v1/profiles/${PROFILE}/invoices?limit=2&status=paid&q=INV-0042`,
      `https://api.example.com/v1/profiles/${PROFILE}/invoices?limit=2&status=paid&q=INV-0042&cursor=2`,
    ]);
    expect(requests.map((r) => r.headers.get("Authorization"))).toEqual(
      Array(3).fill(`Bearer ${KEY}`),
    );
  });

  it("lists webhook events of one type through nextCursor", async () => {
    const { client, requests } = fake([
      { json: { items: [{ id: "evt_2" }], nextCursor: "9" } },
      { json: { items: [{ id: "evt_1" }], nextCursor: null } },
    ]);
    const ids: string[] = [];
    for await (const event of client.webhookEvents.list({ type: "invoice.paid" }))
      ids.push(event.id);
    expect(ids).toEqual(["evt_2", "evt_1"]);
    expect(requests[1]?.url).toBe(
      `https://api.example.com/v1/profiles/${PROFILE}/webhook-events?type=invoice.paid&cursor=9`,
    );
  });

  it("throws a ForwendError with the status and code of an error answer", async () => {
    const { client } = fake([
      {
        status: 409,
        json: { error: { code: "idempotency_conflict", message: "key used with other values" } },
      },
    ]);
    const error = await client.invoices
      .create({ amountUsd: "5" }, { idempotencyKey: "k" })
      .catch((e) => e);
    expect(error).toBeInstanceOf(ForwendError);
    expect(error).toMatchObject({
      status: 409,
      code: "idempotency_conflict",
      message: "key used with other values",
    });
  });

  it("throws a ForwendError for an answer that is not JSON: a proxy's error page, or a broken success", async () => {
    for (const [status, code] of [
      [502, "unknown"],
      [200, "invalid_response"],
    ] as const) {
      const client = new Forwend({
        apiKey: KEY,
        profileId: PROFILE,
        baseUrl: "https://api.example.com",
        fetch: async () => new Response("<html>a page</html>", { status }),
      });
      const error = await client.invoices.get("0xa").catch((e) => e);
      expect(error).toBeInstanceOf(ForwendError);
      expect(error).toMatchObject({ status, code });
    }
  });

  it("keeps a path in the base address, as for https://forwend.com/api", async () => {
    const requests: Request[] = [];
    for (const baseUrl of ["https://forwend.com/api", "https://forwend.com/api/"]) {
      const client = new Forwend({
        apiKey: KEY,
        profileId: PROFILE,
        baseUrl,
        fetch: async (input, init) => {
          requests.push(new Request(input, init));
          return Response.json({ invoiceId: "0xa" });
        },
      });
      await client.invoices.get("0xa");
    }
    expect(requests.map((r) => r.url)).toEqual(
      Array(2).fill(`https://forwend.com/api/v1/profiles/${PROFILE}/invoices/0xa`),
    );
  });

  it("has no runtime dependencies", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
  });
});
