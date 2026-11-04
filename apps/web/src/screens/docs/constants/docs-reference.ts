import type { DocsArticle } from "../types/docs";

export const REFERENCE_PAGES: readonly DocsArticle[] = [
  {
    slug: "reference/errors",
    group: "Reference",
    title: "Errors",
    description: "Use stable error codes to decide whether to retry or fix a request.",
    sections: [
      {
        id: "shape",
        title: "Error response",
        paragraphs: [
          "Errors have an HTTP status and {error: {code, message}}. The message explains the issue to a person and can change. Branch on the code.",
        ],
        code: {
          language: "JSON",
          code: '{\n  "error": {\n    "code": "idempotency_conflict",\n    "message": "The idempotency key was used for a different request"\n  }\n}',
        },
      },
      {
        id: "codes",
        title: "Common status codes",
        fields: [
          {
            name: "400 malformed_request",
            type: "fix request",
            description:
              "Malformed JSON or a missing/invalid required header. Some invalid list parameters also return 400.",
          },
          {
            name: "401 unauthorized / invalid_api_key",
            type: "fix authentication",
            description: "Missing Bearer credentials, or an invalid, revoked or expired key.",
          },
          {
            name: "403 forbidden",
            type: "fix access",
            description: "Wrong profile or missing scope.",
          },
          {
            name: "404 invoice_not_found / payment_not_found / store_not_found",
            type: "check identity",
            description:
              "The object does not exist within the caller’s permitted profile, store and mode.",
          },
          {
            name: "409 idempotency_conflict",
            type: "resolve conflict",
            description:
              "A reused key has different purchase terms. Do not blindly issue a new key.",
          },
          {
            name: "409 billing_details_required",
            type: "complete setup",
            description: "Save profile billing details in the app before creating a payment.",
          },
          {
            name: "422 invalid_value",
            type: "fix value",
            description: "A field, token choice or store violates the operation’s rules.",
          },
          {
            name: "429 rate_limited",
            type: "retry later",
            description: "Wait the seconds provided in Retry-After.",
          },
          {
            name: "500 internal",
            type: "retry carefully",
            description:
              "Unexpected server error. Retry creates with the original idempotency key.",
          },
          {
            name: "503 network_not_ready",
            type: "retry later",
            description: "Network setup or readiness is incomplete.",
          },
        ],
      },
      {
        id: "retries",
        title: "Retry without duplicating an order",
        paragraphs: [
          "Keep your original idempotency key after a timeout or retryable failure. Read an existing order’s stored session before deciding to create another attempt.",
          "Do not retry validation failures unchanged. Do not expose server secrets in logs or error messages.",
        ],
        links: [{ label: "Idempotency rules", slug: "reference/request-rules" }],
      },
    ],
  },
  {
    slug: "reference/request-rules",
    group: "Reference",
    title: "Idempotency, pages and metadata",
    description: "Shared request rules for predictable retries and exact data.",
    sections: [
      {
        id: "idempotency",
        title: "Idempotency",
        paragraphs: [
          "Idempotency prevents duplicate operations when the same request is retried. Creates require an Idempotency-Key header between 1 and 255 UTF-8 bytes.",
          "The same profile, key and normalized request return the existing object with HTTP 200. A changed body returns 409 idempotency_conflict. New objects return 201.",
          "Save one key for each purchase attempt. A random key created anew on every retry defeats duplicate protection.",
        ],
      },
      {
        id: "pagination",
        title: "Pagination",
        paragraphs: [
          "Invoice, checkout-session and webhook-event lists return {items, nextCursor}, newest first. limit accepts 1–100 and defaults to 50.",
          "Pass nextCursor as cursor for the next request. A null nextCursor means there are no more pages. Keep any filters the same while paging.",
          "The store and token endpoints return their complete scoped lists instead of cursor pages.",
        ],
        code: { language: "JSON", code: '{\n  "items": [],\n  "nextCursor": null\n}' },
      },
      {
        id: "metadata",
        title: "Metadata",
        paragraphs: [
          "Attach your own order identifier with metadata at create time. You can set up to 20 keys, each 1–40 letters, digits, underscores or hyphens.",
          "Values are single-line plain text up to 500 characters. Metadata is immutable, appears in owner reads and webhooks, and defaults to {}.",
          "Public pay pages and PDFs do not show metadata. Keep credentials, personal secrets and payment authorization out of it.",
        ],
      },
      {
        id: "money",
        title: "Money representation",
        paragraphs: [
          "amountUsd is an exact decimal string such as 1250.00. amount is an integer string in token base units. Never use floating-point math for money.",
          "A token with six decimals represents 1250 tokens as 1250000000 base units. Use bigint for arithmetic and preserve strings across JSON.",
          "Identify a token by chainId and contract address together. A ticker or icon does not identify an enabled payment asset.",
        ],
        links: [{ label: "Tokens reference", slug: "api/tokens" }],
      },
    ],
  },
  {
    slug: "reference/networks",
    group: "Reference",
    title: "Networks and tokens",
    description: "Verified test configuration, with the exact network names preserved.",
    sections: [
      {
        id: "pairs",
        title: "Configured test pairs",
        paragraphs: [
          "These pairs are present in configuration and seed data. They do not prove production launch or that every profile currently accepts them.",
        ],
        fields: [
          {
            name: "Base Sepolia · 84532",
            type: "USDC · 6 decimals",
            description: "Test network. Read enabled token contracts from the API.",
          },
          {
            name: "Arbitrum Sepolia · 421614",
            type: "USDC · 6 decimals",
            description: "Test network. Read enabled token contracts from the API.",
          },
          {
            name: "Arc Testnet · 5042002",
            type: "USDC · 6 decimals",
            description: "Test network. Read enabled token contracts from the API.",
          },
          {
            name: "Tempo Moderato · 42431",
            type: "OUSD · 6 decimals",
            description:
              "Test network. OUSD starts off for profiles and must be enabled deliberately.",
          },
        ],
      },
      {
        id: "enabled",
        title: "Check what your integration accepts",
        paragraphs: [
          "Read GET /v1/profiles/{profileId}/tokens with tokens.read. The response includes globally enabled assets and the profile’s on switch.",
          "A store can further turn assets off. Use the payment’s returned options as the source for its actual token/network combinations.",
          "USDT artwork or metadata does not establish enabled USDT payments. Production networks and assets remain unverified.",
        ],
        links: [
          { label: "Token API", slug: "api/tokens" },
          { label: "Test mode", slug: "start/test-mode" },
        ],
      },
    ],
  },
  {
    slug: "updates/versions",
    group: "Updates",
    title: "Packages and compatibility",
    description: "Published packages and the API’s change policy.",
    sections: [
      {
        id: "packages",
        title: "Verified package versions",
        fields: [
          {
            name: "forwend",
            type: "0.1.0 · Node ≥20",
            description:
              "Invoices, webhook-event listing and signature verification. No runtime dependencies.",
          },
          {
            name: "@forwend/js",
            type: "0.1.0 · browser",
            description: "mountCheckout, payUrl and linkUrl.",
          },
          {
            name: "@forwend/react",
            type: "0.1.0 · React 18 / 19",
            description: "Checkout, PaymentElement and PayButton.",
          },
        ],
        paragraphs: [
          "Versions and exports were checked against published registry packages. Repository source includes newer checkout-session client methods that are not in forwend 0.1.0.",
        ],
      },
      {
        id: "policy",
        title: "Compatibility policy",
        paragraphs: [
          "The /v1 API stays compatible. New response fields, optional parameters, event types and error codes may appear; ignore fields you do not recognize.",
          "Removing or renaming a field, or changing its type or meaning, is a breaking change. The changelog announces breaking changes at least 90 days before.",
        ],
        links: [{ label: "Changelog", slug: "updates/changelog" }],
      },
    ],
  },
  {
    slug: "updates/changelog",
    group: "Updates",
    title: "Changelog",
    description: "Verified releases, newest first.",
    sections: [
      {
        id: "2026-10-31",
        title: "2026-10-31 · Browser checkout",
        points: [
          "@forwend/js and @forwend/react 0.1.0 published under the MIT license.",
          "Embedded checkout supports store allowed origins and a full checkout or payment-only layout.",
          "Checkout-session HTTP operations create, read, list and expire store-scoped purchase attempts.",
        ],
      },
      {
        id: "2026-10-26",
        title: "2026-10-26 · Server integration",
        points: [
          "forwend 0.1.0 published for Node, with invoice methods, webhook-event listing and verification.",
          "Webhook-event listing covers 30 days; invoice creates accept immutable metadata.",
          "invoice.open and invoice.reopened events describe removed or reopened payment states.",
        ],
      },
      {
        id: "2026-10-25",
        title: "2026-10-25 · Keys and webhooks",
        points: [
          "Test-mode API keys available in Developers.",
          "Signed webhook delivery, retry history and endpoint signing secrets available.",
        ],
      },
    ],
  },
];
