import type { DocsArticle } from "../types/docs";
import { API_PAGES } from "./docs-api";
import { GUIDE_PAGES } from "./docs-guides";
import { REFERENCE_PAGES } from "./docs-reference";

export const DOCS = {
  title: "Documentation",
  heading: "Build your payment flow.",
  description:
    "Guides and API references for stablecoin invoices, payment links and checkout. Try a test payment in Developer mode first.",
} as const;

export const DOCS_GROUPS = [
  "Start here",
  "Collect payments",
  "Integrate",
  "API reference",
  "Reference",
  "Updates",
] as const;
export const DOCS_PAGES: readonly DocsArticle[] = [
  ...GUIDE_PAGES,
  ...API_PAGES,
  ...REFERENCE_PAGES,
];

export const LEGACY_DOCS_ANCHORS: Readonly<Record<string, { slug: string; heading?: string }>> = {
  start: { slug: "start/first-test-payment" },
  keys: { slug: "integrate/authentication" },
  "test-mode": { slug: "start/test-mode" },
  idempotency: { slug: "reference/request-rules", heading: "idempotency" },
  pages: { slug: "reference/request-rules", heading: "pagination" },
  errors: { slug: "reference/errors" },
  metadata: { slug: "reference/request-rules", heading: "metadata" },
  webhooks: { slug: "integrate/webhooks" },
  verify: { slug: "integrate/webhooks", heading: "verify" },
  node: { slug: "integrate/server-setup" },
  checkout: { slug: "collect/embedded-checkout" },
  versioning: { slug: "updates/versions", heading: "policy" },
  changelog: { slug: "updates/changelog" },
};
