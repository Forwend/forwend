import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhook, WebhookVerificationError } from "../src/index.js";

// The Standard Webhooks spec's own example.
const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const ID = "msg_p5jXN8AQM9LWM0D4loKWxJek";
const TIMESTAMP = 1614265330;
const PAYLOAD = '{"test": 2432232314}';
const SIGNATURE = "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=";
const AT = new Date(TIMESTAMP * 1000);
const OTHER = `whsec_${Buffer.alloc(32, 7).toString("base64")}`;

const headers = (signature = SIGNATURE, timestamp = String(TIMESTAMP)) => ({
  "webhook-id": ID,
  "webhook-timestamp": timestamp,
  "webhook-signature": signature,
});

const sign = (secret: string) =>
  `v1,${createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
    .update(`${ID}.${TIMESTAMP}.${PAYLOAD}`)
    .digest("base64")}`;

describe("verifyWebhook", () => {
  it("returns the event when a signature matches one of the secrets", () => {
    expect(
      verifyWebhook({ payload: PAYLOAD, headers: headers(), secrets: SECRET, now: AT }),
    ).toEqual({
      test: 2432232314,
    });
    // During a rotation: two signatures, and the receiver may hold either secret.
    const both = `${sign(OTHER)} ${SIGNATURE}`;
    for (const secrets of [[SECRET], [OTHER], [OTHER, SECRET]]) {
      expect(verifyWebhook({ payload: PAYLOAD, headers: headers(both), secrets, now: AT })).toEqual(
        {
          test: 2432232314,
        },
      );
    }
    // The receiver's matching secret need not be its first one.
    expect(
      verifyWebhook({ payload: PAYLOAD, headers: headers(), secrets: [OTHER, SECRET], now: AT }),
    ).toEqual({
      test: 2432232314,
    });
    const fetchHeaders = new Headers(headers());
    expect(
      verifyWebhook({
        payload: Buffer.from(PAYLOAD),
        headers: fetchHeaders,
        secrets: SECRET,
        now: AT,
      }),
    ).toEqual({ test: 2432232314 });
  });

  it("refuses a wrong secret, a changed body, a timestamp over 5 minutes off and missing headers", () => {
    const refuses = (options: Parameters<typeof verifyWebhook>[0]) =>
      expect(() => verifyWebhook(options)).toThrow(WebhookVerificationError);
    refuses({ payload: PAYLOAD, headers: headers(), secrets: OTHER, now: AT });
    refuses({ payload: '{"test": 2432232315}', headers: headers(), secrets: SECRET, now: AT });
    refuses({
      payload: PAYLOAD,
      headers: headers(SIGNATURE.replace("v1", "v2")),
      secrets: SECRET,
      now: AT,
    });
    refuses({
      payload: PAYLOAD,
      headers: headers(),
      secrets: SECRET,
      now: new Date((TIMESTAMP + 301) * 1000),
    });
    refuses({
      payload: PAYLOAD,
      headers: headers(),
      secrets: SECRET,
      now: new Date((TIMESTAMP - 301) * 1000),
    });
    refuses({ payload: PAYLOAD, headers: { "webhook-id": ID }, secrets: SECRET, now: AT });
    // A timestamp that is not a plain number, a cut-off signature, and a broken clock or tolerance.
    refuses({
      payload: PAYLOAD,
      // Signed, so only the timestamp's shape refuses it.
      headers: headers(
        `v1,${createHmac("sha256", Buffer.from(SECRET.slice(6), "base64"))
          .update(`${ID}.${TIMESTAMP}.0.${PAYLOAD}`)
          .digest("base64")}`,
        `${TIMESTAMP}.0`,
      ),
      secrets: SECRET,
      now: AT,
    });
    refuses({
      payload: PAYLOAD,
      headers: headers(SIGNATURE.slice(0, 20)),
      secrets: SECRET,
      now: AT,
    });
    refuses({ payload: PAYLOAD, headers: headers(), secrets: SECRET, now: new Date(Number.NaN) });
    refuses({
      payload: PAYLOAD,
      headers: headers(),
      secrets: SECRET,
      now: AT,
      toleranceSeconds: Number.NaN,
    });
    // At exactly 5 minutes it still passes.
    expect(() =>
      verifyWebhook({
        payload: PAYLOAD,
        headers: headers(),
        secrets: SECRET,
        now: new Date((TIMESTAMP + 300) * 1000),
      }),
    ).not.toThrow();
  });

  it("refuses a secret that decodes to too short a key, so an empty one can't pass a forged webhook", () => {
    // Each request is signed with the very key the secret decodes to: only the length rule can refuse it.
    const short = Buffer.alloc(16, 1);
    for (const [secret, key] of [
      ["", Buffer.alloc(0)],
      ["whsec_", Buffer.alloc(0)],
      ["whsec_!!!!", Buffer.alloc(0)],
      [`whsec_${short.toString("base64")}`, short],
    ] as const) {
      const signed = `v1,${createHmac("sha256", key).update(`${ID}.${TIMESTAMP}.${PAYLOAD}`).digest("base64")}`;
      expect(() =>
        verifyWebhook({ payload: PAYLOAD, headers: headers(signed), secrets: [secret], now: AT }),
      ).toThrow(WebhookVerificationError);
    }
  });
});
