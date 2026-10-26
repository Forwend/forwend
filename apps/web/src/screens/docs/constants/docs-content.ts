import type { DocsSection } from "@/screens/docs/types/docs";
import { SITE } from "@/shared/config/site";

/** Where a server calls the API: the site's /api, then each route's /v1/… path. */
export const API_ADDRESS = `${SITE.url}/api`;

/** R-155: the public developer docs. Every fact here is in docs/backend/api.md; keep the two in step. */
export const DOCS = {
  title: "API docs",
  description:
    "Create invoices from your server, read them, and hear about every payment through signed webhooks.",
  heading: "The Forwend API",
  intro:
    "Create invoices from your server, read them, and hear about every payment through signed webhooks. Every network is a testnet for now, so every key and invoice is in test mode.",
  contents: "On this page",
  home: "Forwend home",
  sections: [
    {
      id: "start",
      title: "Getting started",
      paragraphs: [
        `The API is at \`${API_ADDRESS}\`. Each route's path goes after it, such as \`/v1/profiles/{profileId}/invoices\`.`,
        "Make a secret key on the Developers page of a freelancer or merchant profile. The profile ID is on the same page. Send the key as `Authorization: Bearer fw_test_…` on every request.",
      ],
      points: [
        "`POST /v1/profiles/{profileId}/invoices` creates an invoice for `amountUsd`, which the payer pays in any accepted stablecoin. Or send `chainId`, the token's contract as `token`, and `amount` in the token's base units.",
        "`GET /v1/profiles/{profileId}/invoices/{invoiceId}` reads one, and `GET /v1/profiles/{profileId}/invoices` lists them.",
        "A create needs the profile's billing details, saved in the app first; without them it is `409 billing_details_required`.",
        "`expiresIn` is how many seconds the checkout stays open: 900 to 31536000. Without it, a `dueDate` keeps the checkout open to the end of the 60th day after it. With neither, it closes after an hour, or after your store's default.",
      ],
      code: {
        language: "Shell",
        code: `curl ${API_ADDRESS}/v1/profiles/$PROFILE_ID/invoices \\
  -H "Authorization: Bearer $FORWEND_KEY" \\
  -H "Idempotency-Key: order-1042" \\
  -H "Content-Type: application/json" \\
  -d '{"amountUsd": "1250.00", "metadata": {"order_id": "1042"}}'`,
      },
    },
    {
      id: "keys",
      title: "API keys",
      points: [
        "A key starts with `fw_test_` and works in test mode only. Keep it on your server, never in a web page or an app.",
        "Its scopes are any of `invoices.read`, `invoices.write`, `stores.read` and `tokens.read`. No key can move money, or change the team or billing details.",
        "A merchant's key works for one store: it sees only that store's invoices and events.",
        "Roll a key to replace it: the old one can keep working for up to 7 days while you swap it. Revoke a key to stop it at once.",
      ],
    },
    {
      id: "test-mode",
      title: "Test mode",
      paragraphs: [
        "An invoice on a testnet is in test mode: its `livemode` is `false`, and its tokens have no value. Every invoice, webhook and event says which mode it is in.",
        "Live mode comes with mainnet networks. Objects of one mode never reach the other: a key works only with invoices of its own mode.",
      ],
    },
    {
      id: "idempotency",
      title: "Idempotency",
      points: [
        "A create must send an `Idempotency-Key` header of 1 to 255 bytes. Your own order ID works well.",
        "The same key and body return the same invoice, so a retry after a timeout never makes a second one.",
        "The same key with a different body is `409 idempotency_conflict`.",
      ],
    },
    {
      id: "pages",
      title: "Lists and pages",
      points: [
        "Lists come newest first, 50 at a time; `limit` takes 1 to 100.",
        "Each page has `nextCursor`. Send it as `cursor` for the next page; it is `null` on the last one.",
        "The invoice list also takes `status` and `q`, a search.",
      ],
    },
    {
      id: "errors",
      title: "Errors",
      paragraphs: [
        'An error answer has a status and a body like `{"error": {"code": "invalid_value", "message": "…"}}`. Act on the code: it stays the same. The message is for people and may change.',
      ],
      points: [
        "`400 malformed_request`: the JSON or a header is broken. The invoice list also answers 400 to a `limit` that is not a number.",
        "`401 unauthorized`: no key, or a header that is not `Bearer fw_…`. `401 invalid_api_key`: the key is wrong, past the end of a roll, or revoked.",
        "`403 forbidden`: the key lacks the scope, or the route names another profile.",
        "`404`: no such object for this key, such as `invoice_not_found`. Another store's invoice is 404 too.",
        "`409`: a conflict the code names, such as `idempotency_conflict` or `billing_details_required`.",
        "`422 invalid_value`: a value breaks a rule, such as a store the key doesn't work for. The message names it.",
        "`429 rate_limited`: wait the seconds in the `Retry-After` header.",
        "`500 internal`: try again later.",
        "`503 network_not_ready`: the network is starting; try again in a minute.",
      ],
    },
    {
      id: "metadata",
      title: "Metadata",
      points: [
        "A create takes `metadata`: up to 20 keys of 1 to 40 letters, digits, `_` or `-`.",
        "Each value is plain text on one line, up to 500 characters. Metadata is set once, at create.",
        "Your reads, lists and webhooks return it, as `{}` when you sent none. The pay page and the PDFs never show it.",
      ],
    },
    {
      id: "webhooks",
      title: "Webhooks",
      paragraphs: [
        "Add an endpoint on the Developers page: an `https` address on your server and the events it takes. A merchant's endpoint takes one store or all of them.",
      ],
      points: [
        "Events: `invoice.detected`, `invoice.partially_paid`, `invoice.paid`, `invoice.settled`, `invoice.expired`, `invoice.canceled` and `invoice.held`.",
        "A body is `{id, type, livemode, sequence, timestamp, data: {invoice, held}}`. `data.invoice` is the invoice as you read it when the webhook is sent.",
        "`sequence` counts an invoice's events from 1. Webhooks can arrive out of order: skip one older than the newest you have.",
        "Answer with a 2xx within 15 seconds. Anything else, a redirect too, is tried again after 5 s, 5 min, 30 min, 2 h and 5 h, then every 10 h: 12 tries in about 3 days.",
        "A `410`, or a delivery's last failure, turns the endpoint off and emails you. Turn it on again on the Developers page.",
        "The Developers page shows each delivery and its tries. It resends one, sends a `webhook.test` event, and resends what failed in a window.",
        "`GET /v1/profiles/{profileId}/webhook-events` lists the last 30 days of events. Each body holds the invoice as it is when you list it.",
      ],
    },
    {
      id: "verify",
      title: "Verifying webhooks",
      points: [
        "Each webhook carries `webhook-id`, `webhook-timestamp` and `webhook-signature`, as Standard Webhooks defines them.",
        "The signature is `v1,` and the base64 HMAC-SHA256 of `id.timestamp.body`, keyed by your secret's bytes after `whsec_`.",
        "Check it against the raw body, before any JSON parsing. Refuse a timestamp more than 5 minutes from now.",
        "Reveal or rotate the secret on the Developers page. After a rotation the old secret also signs for 24 hours, so both signatures come.",
      ],
      code: {
        language: "TypeScript",
        code: `import express from "express";
import { verifyWebhook } from "forwend";

const app = express();

// The raw body: a body parsed and written again won't match its signature.
app.post("/forwend/webhooks", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const event = verifyWebhook({
      payload: req.body,
      headers: req.headers,
      secrets: [process.env.FORWEND_WEBHOOK_SECRET ?? ""],
    });
    if (event.type === "invoice.paid") {
      markOrderPaid(event.data.invoice.metadata.order_id);
    }
    res.sendStatus(204);
  } catch {
    res.sendStatus(400);
  }
});`,
      },
    },
    {
      id: "node",
      title: "The forwend package",
      paragraphs: [
        "`forwend` is a client for Node 20 or later, with no dependencies. It creates, reads and lists invoices, lists events page by page, and verifies webhooks. It is not on npm yet.",
      ],
      code: {
        language: "TypeScript",
        code: `import { Forwend } from "forwend";

const forwend = new Forwend({
  apiKey: process.env.FORWEND_KEY ?? "",
  profileId: process.env.FORWEND_PROFILE_ID ?? "",
  baseUrl: "${API_ADDRESS}",
});

const invoice = await forwend.invoices.create(
  { amountUsd: "1250.00", metadata: { order_id: "1042" } },
  { idempotencyKey: "order-1042" },
);

for await (const event of forwend.webhookEvents.list({ type: "invoice.paid" })) {
  console.log(event.id, event.data.invoice.number);
}`,
      },
    },
    {
      id: "versioning",
      title: "Versioning",
      points: [
        "`/v1` stays compatible. New fields, optional parameters, event types and error codes can come at any time: ignore what you don't know.",
        "Removing or renaming a field, or changing its type or meaning, is a breaking change. The changelog announces it at least 90 days before.",
      ],
    },
  ] satisfies readonly DocsSection[],
  changelog: {
    id: "changelog",
    title: "Changelog",
    note: "Newest first.",
    entries: [
      {
        date: "2026-10-26",
        changes: [
          "`GET /v1/profiles/{profileId}/webhook-events` lists the last 30 days of events.",
          "Invoice create takes `metadata`.",
          "A `dueDate` with no `expiresIn` keeps the checkout open 60 days past it.",
          "The `forwend` package for Node, not on npm yet.",
        ],
      },
      {
        date: "2026-10-25",
        changes: [
          "Webhooks: endpoints with signing secrets, invoice events, and signed delivery with retries.",
          "Secret API keys for test mode, on the Developers page.",
        ],
      },
    ],
  },
} as const;
