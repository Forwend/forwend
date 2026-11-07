import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookVerificationError } from "./errors.js";
import type { TestWebhookEvent, WebhookEvent } from "./types.js";

export interface VerifyWebhookOptions {
  /** The request body exactly as it arrived: a body parsed and written again won't match its signature. */
  payload: string | Uint8Array;
  /** fetch Headers, or a plain object such as Node's incoming headers; names in any case. */
  headers: Headers | Record<string, string | string[] | undefined>;
  /** The endpoint's signing secrets (whsec_…): during a rotation's 24 hours, the new and the old one. */
  secrets: string | readonly string[];
  /** How far the webhook-timestamp may be from now, in seconds; 300 by default. */
  toleranceSeconds?: number;
  now?: Date;
}

// Standard Webhooks keys are 24 to 64 bytes; an empty or short one would let anyone sign.
const MIN_KEY_BYTES = 24;

const header = (headers: VerifyWebhookOptions["headers"], name: string): string | undefined => {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  const value = key === undefined ? undefined : headers[key];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Checks a webhook's Standard Webhooks headers (D-42) and returns its event. The signature must match one of the
 * secrets, and the timestamp must be within the tolerance, so an old request can't be sent again.
 */
export function verifyWebhook(options: VerifyWebhookOptions): WebhookEvent | TestWebhookEvent {
  const secrets = typeof options.secrets === "string" ? [options.secrets] : options.secrets;
  const keys = secrets.map((secret) => Buffer.from(secret.replace(/^whsec_/, ""), "base64"));
  if (keys.length === 0 || keys.some((key) => key.length < MIN_KEY_BYTES)) {
    throw new WebhookVerificationError(
      "each secret must be the base64 of at least 24 bytes, after an optional whsec_",
    );
  }
  const id = header(options.headers, "webhook-id");
  const timestamp = header(options.headers, "webhook-timestamp");
  const signatures = header(options.headers, "webhook-signature");
  if (!id || !timestamp || !signatures) {
    throw new WebhookVerificationError(
      "missing webhook-id, webhook-timestamp or webhook-signature",
    );
  }
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
  // Written so a NaN from a bad now or tolerance refuses, rather than passing every comparison.
  if (
    !/^\d+$/.test(timestamp) ||
    !(Math.abs(now - Number(timestamp)) <= (options.toleranceSeconds ?? 300))
  ) {
    throw new WebhookVerificationError("webhook-timestamp is too far from now");
  }
  const payload = Buffer.from(options.payload);
  const signed = Buffer.concat([Buffer.from(`${id}.${timestamp}.`), payload]);
  const given = signatures
    .split(" ")
    .filter((s) => s.startsWith("v1,"))
    .map((s) => Buffer.from(s.slice(3), "base64"));
  const matches = keys.some((key) => {
    const expected = createHmac("sha256", key).update(signed).digest();
    return given.some((sig) => sig.length === expected.length && timingSafeEqual(sig, expected));
  });
  if (!matches) throw new WebhookVerificationError("no signature matches the secrets");
  try {
    return JSON.parse(payload.toString("utf8"));
  } catch {
    throw new WebhookVerificationError("the signed body is not JSON");
  }
}
