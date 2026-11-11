import type { DocsArticle, DocsField, DocsSection } from "../types/docs";
import { CHECKOUT_REQUEST, INVOICE_REQUEST } from "./docs-examples";

const PROFILE = "/v1/profiles/{profileId}";
const PATH: readonly DocsField[] = [
  {
    name: "profileId",
    type: "path · required UUID",
    description: "The profile that owns your API key.",
  },
];
const PAGINATION: readonly DocsField[] = [
  { name: "limit", type: "query · integer", description: "1–100; default 50." },
  {
    name: "cursor",
    type: "query · string",
    description: "The previous response’s nextCursor. Omit for the first page.",
  },
];
const CREATE_HEADERS: DocsSection = {
  id: "headers",
  title: "Request headers",
  fields: [
    {
      name: "Authorization",
      type: "header · required",
      description: "Bearer followed by your server-only API key.",
    },
    {
      name: "Content-Type",
      type: "header · required",
      description: "application/json for a create request.",
    },
    {
      name: "Idempotency-Key",
      type: "header · required for create",
      description: "1–255 UTF-8 bytes. Reuse the same key and normalized body for a retry.",
    },
  ],
  links: [{ label: "Idempotency and pagination", slug: "reference/request-rules" }],
};
const ERRORS: DocsSection = {
  id: "errors",
  title: "Errors",
  paragraphs: [
    "Responses use {error: {code, message}}. Missing or invalid credentials return 401; missing scope or a different profile returns 403. Objects outside the caller’s store or mode are hidden with 404.",
    "Invalid values return 422 invalid_value. Rate limiting returns 429 rate_limited with Retry-After. A starting network can return 503 network_not_ready; an unexpected server error returns 500 internal.",
  ],
  links: [{ label: "All error handling rules", slug: "reference/errors" }],
};

export const API_PAGES: readonly DocsArticle[] = [
  {
    slug: "api/invoices",
    group: "API reference",
    title: "Invoices",
    description: "Create, read and list billing invoices using a profile-scoped server key.",
    sections: [
      {
        id: "create",
        title: "Create an invoice",
        method: "POST",
        path: `${PROFILE}/invoices`,
        scope: "invoices.write",
        paragraphs: [
          "Returns 201 for a new invoice, or 200 for an exact replay. Save billing details first; otherwise the response is 409 billing_details_required.",
          "Choose amountUsd, or the complete chainId + token + amount set. Do not send both pricing forms. Store and profile token switches apply.",
        ],
        fields: PATH,
        fieldLabel: "Path parameters",
        code: { language: "TypeScript", code: INVOICE_REQUEST },
      },
      CREATE_HEADERS,
      {
        id: "body",
        title: "Create request body",
        fieldLabel: "JSON body",
        fields: [
          {
            name: "amountUsd",
            type: "string · pricing option",
            description:
              "Positive USD decimal string, representable exactly by every accepted token. Example: 1250.00.",
          },
          {
            name: "chainId, token, amount",
            type: "integer, address, string · pricing option",
            description:
              "Fixed token: network ID, enabled token contract and positive integer base units. For 6 decimals, 1250000000 represents 1250 tokens.",
          },
          {
            name: "feesPaidBy",
            type: "string · optional",
            description:
              "owner, deducted at settlement, or client, added on top of the price. Defaults to the profile’s choice.",
          },
          {
            name: "storeId",
            type: "UUID · optional",
            description:
              "Merchant store. Defaults to the first store; a store-scoped key must use its own store.",
          },
          {
            name: "title, note, reference",
            type: "strings · optional",
            description: "Title ≤200 characters, payer note ≤2000, single-line reference ≤100.",
          },
          {
            name: "expiresIn",
            type: "integer · optional",
            description:
              "900–31536000 seconds. Defaults to one hour or the store default, unless dueDate is set.",
          },
          {
            name: "dueDate, supplyDate",
            type: "YYYY-MM-DD · optional",
            description:
              "Payment due date and work delivery date. With dueDate but no expiresIn, checkout closes at the end of the 60th UTC day after it.",
          },
          {
            name: "client",
            type: "object · optional",
            description: "name, email, address, country and taxId for the invoice’s customer.",
          },
          {
            name: "lines",
            type: "array · optional",
            description:
              "Up to 100 {description, quantity, unitPrice} entries. Quantity is a positive decimal string with ≤2 decimals. Unit price uses the chosen pricing unit; items must add up exactly.",
          },
          {
            name: "metadata",
            type: "object · optional",
            description:
              "Up to 20 single-line string values. See request rules for key and value limits.",
          },
          {
            name: "returnUrl",
            type: "string · optional",
            description:
              "HTTPS return URL, without userinfo. For a merchant, it must use a store allowed origin. HTTP return URLs are not accepted.",
          },
          {
            name: "reminders",
            type: "boolean · optional",
            description: "Requires dueDate and client.email when true.",
          },
          {
            name: "agreedValue",
            type: "object · optional",
            description:
              "{currency, amount, date}: agreed fiat value, decimal string in that currency. This records an agreement, not a currency conversion.",
          },
          {
            name: "repeat",
            type: "object · optional",
            description:
              "Monthly billing schedule with optional endDate. Requires the repeating-invoice prerequisites, including dueDate.",
          },
          {
            name: "replaces",
            type: "string · optional",
            description:
              "Invoice being revised. Cancellation checks apply; the replaced invoice must belong to the profile.",
          },
          {
            name: "senderName",
            type: "string · optional",
            description:
              "Name shown for a request without issuer billing details; up to 100 characters.",
          },
        ],
      },
      {
        id: "read",
        title: "Read an invoice",
        method: "GET",
        path: `${PROFILE}/invoices/{invoiceId}`,
        scope: "invoices.read",
        fields: [
          ...PATH,
          {
            name: "invoiceId",
            type: "path · required string",
            description: "Invoice identifier returned by create.",
          },
        ],
        paragraphs: [
          "Returns 200 with the invoice detail. No request body. An unknown or inaccessible invoice returns 404 invoice_not_found.",
        ],
      },
      {
        id: "list",
        title: "List invoices",
        method: "GET",
        path: `${PROFILE}/invoices`,
        scope: "invoices.read",
        fields: [
          ...PATH,
          ...PAGINATION,
          {
            name: "status",
            type: "query · string",
            description:
              "Optional: open, confirming, paid, settled, expired or canceled. This list filter differs from paymentStatus; paid also includes settled invoices.",
          },
          {
            name: "state",
            type: "query · string",
            description:
              "Optional: waiting, confirming, partially_paid, paid, overpaid, expired or canceled. This derived payment state differs from the raw paymentStatus.",
          },
          {
            name: "q",
            type: "query · string",
            description:
              "Optional search text. Omit when unused; a present but blank q is rejected.",
          },
        ],
        paragraphs: [
          "Returns 200 with {items, nextCursor}, newest first. nextCursor is null on the last page. No request body.",
        ],
      },
      {
        id: "fees",
        title: "Preview fees",
        method: "GET",
        path: `${PROFILE}/fees`,
        scope: "invoices.read",
        fields: [
          ...PATH,
          {
            name: "amountUsd, or chainId, token, amount",
            type: "query · required",
            description: "A price, as a create takes it.",
          },
          {
            name: "feesPaidBy",
            type: "query · string",
            description:
              "Optional: owner or client. Prices it with that choice: a client’s fees on top let a smaller price carry them.",
          },
          {
            name: "storeId",
            type: "query · UUID",
            description: "Optional: keeps a merchant store’s tokens. Defaults to the first store.",
          },
        ],
        paragraphs: [
          "Returns 200 with the profile’s feesPaidBy and options: each option’s chainId, token, decimals, price, networkFee and platformFee in base units. No request body.",
          "It leaves out networks as a create does. The invoice gets its own quote when it is made.",
        ],
      },
      {
        id: "response",
        title: "Invoice response",
        fieldLabel: "Response fields",
        fields: [
          {
            name: "invoiceId, payToken, number",
            type: "string, string | null, integer | null",
            description:
              "Identifiers and document number. Hosted payment uses the returned payToken.",
          },
          {
            name: "chainId, token, amount",
            type: "integer, address, string",
            description: "Token identity and amount in integer base units.",
          },
          {
            name: "networkFee, platformFee, netAmount",
            type: "strings",
            description:
              "Fees in the token’s base units; settlement pays both out of amount. netAmount is amount less both fees: what you receive.",
          },
          {
            name: "feesPaidBy",
            type: "string",
            description:
              "owner, deducted at settlement, or client, added on top of the price. When the client pays, amount is the price plus the fees.",
          },
          {
            name: "paymentStatus, confirming",
            type: "string, boolean",
            description:
              "Recorded payment status and whether observed transfers await confirmation.",
          },
          {
            name: "settlementStatus, refundStatus",
            type: "strings",
            description: "Settlement and held-money handling are separate from payment status.",
          },
          {
            name: "livemode",
            type: "boolean",
            description: "true on the live networks; false in test mode, on the test networks.",
          },
          {
            name: "receiveAddress, recipient",
            type: "addresses",
            description: "Payment contract address and settlement destination.",
          },
          {
            name: "expiresAt, closesAt, createdAt",
            type: "RFC 3339 timestamps",
            description: "Original expiry, current close and creation time.",
          },
          {
            name: "metadata, client, store, options",
            type: "objects / array",
            description:
              "Creator metadata, customer/store detail and token options. Detail reads include deposit and settlement records.",
          },
        ],
        paragraphs: [
          "Responses can add fields. Ignore unknown fields and read paymentStatus independently from settlementStatus.",
          "Create conflicts include 409 idempotency_conflict and billing_details_required. Invalid JSON or headers return 400 malformed_request.",
        ],
        links: [{ label: "Payment-state semantics", slug: "integrate/payment-status" }],
      },
      ERRORS,
    ],
  },
  {
    slug: "api/checkout-sessions",
    group: "API reference",
    title: "Checkout sessions",
    description: "One server-created purchase attempt, scoped to a store and mode.",
    sections: [
      {
        id: "create",
        title: "Create a checkout session",
        method: "POST",
        path: `${PROFILE}/checkout-sessions`,
        scope: "invoices.write",
        paragraphs: [
          "Returns 201 for a new attempt, 200 for an exact retry. Requires a merchant store with billing details, wallet and accepted tokens ready.",
          "The Node package wraps them as `forwend.checkoutSessions.create`, `get`, `list` and `expire`.",
        ],
        fields: PATH,
        fieldLabel: "Path parameters",
        code: { language: "JavaScript", code: CHECKOUT_REQUEST },
      },
      CREATE_HEADERS,
      {
        id: "body",
        title: "Create request body",
        fieldLabel: "JSON body",
        fields: [
          {
            name: "storeId",
            type: "UUID · required",
            description: "Merchant store owned by this profile and allowed by the key.",
          },
          {
            name: "amountUsd",
            type: "string · required",
            description: "Exact positive USD decimal. Compute it on your server.",
          },
          {
            name: "feesPaidBy",
            type: "string · optional",
            description:
              "owner, deducted at settlement, or client, added on top of the price. Defaults to the profile’s choice.",
          },
          {
            name: "reference",
            type: "string · optional",
            description: "Immutable order reference; up to 100 characters.",
          },
          {
            name: "title",
            type: "string · optional",
            description: "Purchase title; up to 200 characters.",
          },
          { name: "expiresIn", type: "integer · optional", description: "900–31536000 seconds." },
          {
            name: "returnUrl",
            type: "string · optional",
            description:
              "HTTPS URL on one of the store’s allowed origins. A redirect is not payment proof.",
          },
          {
            name: "customer",
            type: "object · optional",
            description: "name (≤200 characters) and email.",
          },
          {
            name: "items",
            type: "array · optional",
            description:
              "Up to 100 {description, quantity, unitPrice} entries. Description ≤200; positive quantity with ≤2 decimals; USD unitPrice. Totals must match amountUsd.",
          },
          {
            name: "metadata",
            type: "object · optional",
            description: "Up to 20 single-line string values; see request rules.",
          },
        ],
      },
      {
        id: "read",
        title: "Read a checkout session",
        method: "GET",
        path: `${PROFILE}/checkout-sessions/{sessionId}`,
        scope: "invoices.read",
        fields: [
          ...PATH,
          {
            name: "sessionId",
            type: "path · required string",
            description: "Identifier returned by create.",
          },
        ],
        paragraphs: [
          "Returns 200 with canonical session state. No request body. Another store’s or mode’s session is hidden with 404.",
        ],
      },
      {
        id: "list",
        title: "List checkout sessions",
        method: "GET",
        path: `${PROFILE}/checkout-sessions`,
        scope: "invoices.read",
        fields: [
          ...PATH,
          ...PAGINATION,
          {
            name: "storeId",
            type: "query · UUID",
            description: "Optional store filter, still limited by the key’s store.",
          },
        ],
        paragraphs: [
          "Returns 200 with {items, nextCursor}. Items are session objects, newest first. Includes attempts without invoice numbers. No request body.",
        ],
      },
      {
        id: "expire",
        title: "Expire an unpaid attempt",
        method: "POST",
        path: `${PROFILE}/checkout-sessions/{sessionId}/expire`,
        scope: "invoices.write",
        fields: [
          ...PATH,
          {
            name: "sessionId",
            type: "path · required string",
            description: "The session to expire.",
          },
        ],
        paragraphs: [
          "No request body. Returns 200 with the closed session and is idempotent once expired. Payment already seen or confirming returns 409.",
          "Later funds remain held for the payer. Expiration does not erase receive addresses or financial records.",
        ],
      },
      {
        id: "response",
        title: "Session response",
        fields: [
          { name: "sessionId", type: "string", description: "Purchase attempt identifier." },
          {
            name: "status",
            type: "string",
            description:
              "open, complete or expired. Read paymentStatus to determine whether the order is paid.",
          },
          {
            name: "payment.paymentId, reference, storeId",
            type: "string / nullable strings",
            description: "The payment and its original order/store relationship.",
          },
          {
            name: "payment.hostedUrl",
            type: "string | null",
            description: "Hosted checkout URL to redirect the customer to.",
          },
          {
            name: "payment.payToken",
            type: "string | null",
            description:
              "The public pay token, the URL's last segment, for @forwend/js and @forwend/react.",
          },
          {
            name: "payment.chainId, token, amount, symbol, decimals",
            type: "token and money fields",
            description:
              "Amount is a string in integer base units; identify money by chain and contract.",
          },
          {
            name: "payment.networkFee, platformFee, netAmount",
            type: "strings",
            description:
              "Fees in the token’s base units; settlement pays both out of amount. netAmount is amount less both fees: what you receive.",
          },
          {
            name: "payment.feesPaidBy",
            type: "string",
            description:
              "owner, deducted at settlement, or client, added on top of the price. When the client pays, amount is the price plus the fees.",
          },
          {
            name: "payment.paymentStatus, settlementStatus, refundStatus",
            type: "strings",
            description: "Separate payment, wallet settlement and held-money processing.",
          },
          {
            name: "payment.livemode, confirming, closed",
            type: "booleans",
            description: "Mode, pending network confirmation and whether checkout has closed.",
          },
          {
            name: "payment.receipts",
            type: "array",
            description:
              "Per-option chainId, token, symbol, decimals, received, pending and held integer strings.",
          },
          {
            name: "payment.amounts",
            type: "object · optional",
            description:
              "Exact receiver, payable, held, settled and refunded balances, with reconciliation information. settled is what reached your wallet, net of fees.",
          },
          {
            name: "payment.amounts.fees",
            type: "string",
            description: "The network and platform fees settlement paid.",
          },
          {
            name: "payment.amounts.observedRefunded, lastReturnTxHash",
            type: "string, string | null",
            description:
              "Confirmed returns of held money to the payer, and the last return’s transaction hash.",
          },
        ],
        paragraphs: [
          "Changed purchase terms with the same idempotency key return 409 idempotency_conflict. Missing billing details return 409 billing_details_required.",
        ],
      },
      ERRORS,
    ],
  },
  {
    slug: "api/tokens",
    group: "API reference",
    title: "Tokens",
    description: "Read enabled assets and the profile’s acceptance settings.",
    sections: [
      {
        id: "list",
        title: "List token choices",
        method: "GET",
        path: `${PROFILE}/tokens`,
        scope: "tokens.read",
        fields: PATH,
        fieldLabel: "Path parameters",
        paragraphs: [
          "No query parameters or body. Send Authorization: Bearer with your server key. Returns 200 with {tokens: […]}.",
          "The response includes globally enabled tokens. on indicates the profile switch; a merchant store can further restrict these choices.",
        ],
      },
      {
        id: "response",
        title: "Token response",
        fields: [
          { name: "chainId", type: "integer", description: "Network ID." },
          {
            name: "token",
            type: "address",
            description: "Lowercase token contract; unique only together with chainId.",
          },
          {
            name: "symbol, network",
            type: "strings",
            description: "Token symbol and configured network name.",
          },
          {
            name: "decimals",
            type: "integer",
            description: "Decimal places used to convert integer base units for display.",
          },
          {
            name: "on",
            type: "boolean",
            description:
              "Whether the profile accepts this token. Tempo OUSD starts off by default.",
          },
        ],
        links: [{ label: "Networks and tokens", slug: "reference/networks" }],
      },
      ERRORS,
    ],
  },
  {
    slug: "api/stores",
    group: "API reference",
    title: "Stores",
    description: "Read store identity, branding and accepted-origin settings.",
    sections: [
      {
        id: "list",
        title: "List stores",
        method: "GET",
        path: `${PROFILE}/stores`,
        scope: "stores.read",
        fields: PATH,
        fieldLabel: "Path parameters",
        paragraphs: [
          "No query parameters or body. Send Authorization: Bearer with your server key. Returns 200 with {stores: […]}, first-created store first. A store-scoped key sees only its store.",
        ],
      },
      {
        id: "response",
        title: "Store response",
        fields: [
          {
            name: "storeId, name",
            type: "UUID, string",
            description:
              "Public project identity and display name. The ID does not authorize access.",
          },
          {
            name: "defaultExpiresIn",
            type: "integer",
            description: "Default checkout lifetime in seconds.",
          },
          {
            name: "allowedOrigins",
            type: "string[]",
            description: "Exact origins allowed to embed checkout and receive approved returns.",
          },
          {
            name: "tokensOff",
            type: "{chainId, token}[]",
            description: "Enabled assets this store does not accept.",
          },
          {
            name: "brandColor, logoAt",
            type: "string | null",
            description: "Store branding and logo timestamp.",
          },
          { name: "updatedAt", type: "timestamp", description: "Last change in RFC 3339 format." },
        ],
        paragraphs: [
          "Manage stores in the app. A secret API key has stores.read only and cannot create or edit stores.",
          "Stores in one merchant profile share the profile wallet. They do not provide seller-specific settlement.",
        ],
      },
      ERRORS,
    ],
  },
  {
    slug: "api/webhook-events",
    group: "API reference",
    title: "Webhook events",
    description: "Recover recent events and understand the signed delivery envelope.",
    sections: [
      {
        id: "list",
        title: "List events",
        method: "GET",
        path: `${PROFILE}/webhook-events`,
        scope: "invoices.read",
        fields: [
          ...PATH,
          ...PAGINATION,
          {
            name: "type",
            type: "query · event name",
            description: "Optional single event type from the list below.",
          },
        ],
        paragraphs: [
          "Send Authorization: Bearer. No request body. Returns 200 with {items, nextCursor}, newest first, covering the last 30 days.",
          "Items contain the invoice as it is when listed. The endpoint excludes webhook.test events, not test-mode payment events. Store and mode boundaries still apply.",
        ],
      },
      {
        id: "envelope",
        title: "Event envelope",
        fields: [
          {
            name: "id, type",
            type: "strings",
            description: "Stable event ID and event type. Deduplicate by id.",
          },
          { name: "livemode", type: "boolean", description: "false for test-mode payments." },
          {
            name: "sequence",
            type: "integer",
            description: "Increasing sequence per invoice; arrival order is not guaranteed.",
          },
          { name: "timestamp", type: "timestamp", description: "Event creation time in UTC." },
          {
            name: "data.invoice",
            type: "object",
            description:
              "Owner invoice representation, including metadata and payment/settlement state.",
          },
          {
            name: "data.held",
            type: "object | null",
            description:
              "For invoice.held: amount in base units, reason and nullable optionId. Otherwise null.",
          },
        ],
      },
      {
        id: "types",
        title: "Event types",
        fields: [
          {
            name: "invoice.detected",
            type: "payment",
            description: "A transfer was observed; confirmation is still needed.",
          },
          {
            name: "invoice.partially_paid",
            type: "payment",
            description: "Confirmed amount is below the amount owed.",
          },
          {
            name: "invoice.paid",
            type: "payment",
            description: "Payment is complete. Verify canonical state before fulfillment.",
          },
          {
            name: "invoice.settled",
            type: "settlement",
            description: "Funds settled into the profile wallet.",
          },
          {
            name: "invoice.expired, invoice.canceled",
            type: "closure",
            description: "Checkout expired or the invoice was canceled.",
          },
          {
            name: "invoice.held",
            type: "held money",
            description: "Money is held separately for the payer.",
          },
          {
            name: "invoice.open",
            type: "payment",
            description: "A chain reorganization removed the observed payment.",
          },
          {
            name: "invoice.reopened",
            type: "payment",
            description: "An expired, partly paid invoice was reopened.",
          },
        ],
        links: [{ label: "Signatures, retries and processing", slug: "integrate/webhooks" }],
      },
      ERRORS,
    ],
  },
];
