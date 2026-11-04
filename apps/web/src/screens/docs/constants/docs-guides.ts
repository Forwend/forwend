import { APP_ROUTES } from "@/shared/config/routes";
import type { DocsArticle } from "../types/docs";
import {
  API_ADDRESS,
  CHECKOUT_REQUEST,
  INVOICE_REQUEST,
  REACT_CHECKOUT,
  WEBHOOK_VERIFY,
} from "./docs-examples";

export const GUIDE_PAGES: readonly DocsArticle[] = [
  {
    slug: "start/choose-an-integration",
    group: "Start here",
    title: "Choose an integration",
    description: "Start with the way you collect payments. Add code only when you need it.",
    next: "start/first-test-payment",
    sections: [
      {
        id: "without-code",
        title: "Collect payments without code",
        paragraphs: [
          "Freelancers can create an invoice for a particular job, or share a payment link. Your customer opens a hosted payment page and needs no Forwend account.",
          "Businesses can use these same tools. A store groups branding, invoices, checkout attempts and accepted tokens within a merchant profile.",
        ],
        links: [
          { label: "Create an invoice", slug: "collect/invoices" },
          { label: "Share a payment link", slug: "collect/payment-links" },
        ],
      },
      {
        id: "with-code",
        title: "Connect your business",
        paragraphs: [
          "Create a checkout session from your server for one purchase attempt. Send the customer to its hosted URL, or embed checkout in your site.",
          "Builders should start with hosted checkout, then add signed webhooks and server confirmation before fulfilling orders.",
        ],
        links: [
          { label: "Make a first test payment", slug: "start/first-test-payment" },
          { label: "Embed checkout", slug: "collect/embedded-checkout" },
        ],
      },
      {
        id: "boundaries",
        title: "Profiles, stores and settlement",
        paragraphs: [
          "Each profile has its own wallet. A merchant profile’s stores share that wallet; they organize sales and permissions, not separate settlement destinations.",
          "A marketplace is a business use case. Store support does not provide split payments, seller payouts or escrow.",
          "Agentic payments, bank withdrawals and card payments are planned. They are not current integration steps.",
        ],
      },
    ],
  },
  {
    slug: "start/first-test-payment",
    group: "Start here",
    title: "Your first test payment",
    description:
      "Create a hosted checkout, pay with test tokens, and verify the result on your server.",
    previous: "start/choose-an-integration",
    next: "integrate/webhooks",
    sections: [
      {
        id: "prerequisites",
        title: "1. Prepare a merchant profile",
        points: [
          "Sign in, choose business payments or integration, and complete your profile’s billing details.",
          "Create a store. Check that your profile wallet and at least one test token are ready.",
          "Open Developers. Create a test key for that store with invoices.write and invoices.read. Save its profile ID and store ID.",
          "Get test tokens and the network’s fee token for your payer wallet. Use exactly the network shown by checkout. Never send real funds.",
        ],
        links: [
          { label: "Keys and permissions", slug: "integrate/authentication" },
          { label: "Test networks and tokens", slug: "reference/networks" },
        ],
      },
      {
        id: "credentials",
        title: "2. Set server credentials",
        paragraphs: [
          "Store these values in your server’s environment. The documentation host, your application host and the API origin are different settings.",
          "The hosted API address below is the configured application endpoint, not evidence of a production launch. For local development, use http://localhost:8080.",
        ],
        code: {
          language: "Shell",
          code: `export FORWEND_API_URL=${API_ADDRESS}\nexport FORWEND_KEY=fw_test_replace_on_your_server\nexport FORWEND_PROFILE_ID=replace_with_your_profile_id\nexport FORWEND_STORE_ID=replace_with_your_store_id`,
        },
      },
      {
        id: "request",
        title: "3. Create the purchase attempt",
        paragraphs: [
          "Save this JavaScript as create-checkout.mjs, then run node create-checkout.mjs with Node 20 or later. Calculate the price from your own order records. Never trust an amount supplied by the browser.",
          "Keep the idempotency key stable when retrying this purchase attempt. Use a new key for a new attempt.",
        ],
        code: {
          language: "JavaScript",
          code: `${CHECKOUT_REQUEST}\nconsole.log(JSON.stringify({ sessionId: session.sessionId, hostedUrl, livemode: session.payment.livemode }, null, 2));`,
        },
      },
      {
        id: "response",
        title: "4. Open the hosted checkout",
        paragraphs: [
          "The script prints sessionId, hostedUrl and livemode. Save the sessionId as SESSION_ID in your terminal: export SESSION_ID=the_returned_id. A new attempt returns HTTP 201. An exact retry returns HTTP 200 with the original attempt. The following excerpt shows the fields to use; IDs and the hosted URL come from your response.",
        ],
        fields: [
          { name: "sessionId", type: "string", description: "Save this ID beside your order." },
          {
            name: "status",
            type: "string",
            description: "The checkout state: open, complete or expired.",
          },
          {
            name: "payment.hostedUrl",
            type: "string | null",
            description:
              "The customer-facing payment URL. Use the returned URL; do not construct a token.",
          },
          {
            name: "payment.livemode",
            type: "boolean",
            description: "Must be false for this test integration.",
          },
        ],
        points: [
          "Open payment.hostedUrl in your browser.",
          "Choose an available token/network pair, then send the exact test amount to the displayed receive address.",
          "Wait for confirmation. Timing depends on the network; a detected transfer is not a paid order.",
        ],
      },
      {
        id: "completion",
        title: "5. Verify completion on your server",
        paragraphs: [
          "Read the session again with the same store-scoped key. A redirect or browser status callback cannot authorize fulfillment.",
          "Check the saved session ID, order reference, store, mode, expected amount and token/network identity. Fulfill once only after canonical paymentStatus is paid.",
          "For unattended orders, verify signed webhooks, queue them durably, deduplicate event IDs, and fetch the current session before fulfilling. Settlement is a separate step.",
        ],
        code: {
          language: "Shell",
          code: `curl "$FORWEND_API_URL/v1/profiles/$FORWEND_PROFILE_ID/checkout-sessions/$SESSION_ID" \\\n  -H "Authorization: Bearer $FORWEND_KEY"`,
        },
        links: [
          { label: "Set up and verify webhooks", slug: "integrate/webhooks" },
          { label: "Understand payment states", slug: "integrate/payment-status" },
        ],
      },
    ],
  },
  {
    slug: "start/test-mode",
    group: "Start here",
    title: "Test mode",
    description: "Try the full payment flow without treating test tokens as money.",
    sections: [
      {
        id: "availability",
        title: "Verified environment",
        paragraphs: [
          "The verified configuration uses Base Sepolia, Arbitrum Sepolia, Arc Testnet and Tempo Moderato. These are test networks. Production availability has not been verified.",
          "Test objects have livemode: false. Test tokens have no monetary value. A key, invoice or checkout session stays in its own mode.",
        ],
        links: [{ label: "Supported test pairs", slug: "reference/networks" }],
      },
      {
        id: "isolation",
        title: "Keep test and live data separate",
        points: [
          "Use a fw_test_ key for test objects.",
          "A key cannot read another mode’s invoices; those reads return 404.",
          "An invoice cannot mix token options from different modes.",
          "Do not use successful test payments as evidence of mainnet availability.",
        ],
      },
    ],
  },
  {
    slug: "collect/invoices",
    group: "Collect payments",
    title: "Invoices",
    description: "Request payment for a specific job, with a clear document and payment page.",
    sections: [
      {
        id: "create",
        title: "Create one in the app",
        points: [
          "Open Invoices in a freelancer or merchant profile and choose New invoice.",
          "Complete your billing details, add the client and amount, and choose accepted payment options.",
          "Add line items, a due date or a note when needed. Create the invoice and share its payment link.",
          "The payer needs a wallet or exchange that can send the exact token on the displayed network. No Forwend account is required.",
        ],
        paragraphs: [
          `The app’s invoice creation page is ${APP_ROUTES.newInvoice}. Sign in is required to create an invoice, but not to read these docs.`,
        ],
      },
      {
        id: "follow",
        title: "Follow the payment",
        paragraphs: [
          "The invoice distinguishes money detected on the network, confirmed payment and settlement into your profile wallet. Partial, late and excess payments need separate handling.",
          "A due date describes when the client owes payment. Checkout expiry controls when a transfer can count toward that payment; they are different fields.",
        ],
      },
      {
        id: "api",
        title: "Create from your server",
        paragraphs: [
          "The published forwend Node package can create, read and list invoices. Keep its API key on your server.",
        ],
        code: { language: "TypeScript", code: INVOICE_REQUEST },
        links: [{ label: "Invoice API reference", slug: "api/invoices" }],
      },
    ],
  },
  {
    slug: "collect/payment-links",
    group: "Collect payments",
    title: "Payment links",
    description: "Share one payment link in a message or on your website.",
    sections: [
      {
        id: "create",
        title: "Create and share",
        points: [
          "Open Payment links in your profile and choose New payment link.",
          "Add a title and choose a fixed amount, or let the payer enter an amount within your limits.",
          "Choose a store for a merchant link. Confirm its accepted tokens and billing setup.",
          "Share the link’s /l/ address. Each purchase creates its own checkout attempt.",
        ],
        paragraphs: [
          "A link can have an end date or a payment limit. Turning a link off prevents new purchases; it does not rewrite existing payment records.",
        ],
      },
      {
        id: "payments",
        title: "Keep purchases separate",
        paragraphs: [
          "A payment link is an offer, not one shared invoice. Follow each payment in the app. An open attempt can reserve a place while it waits for payment.",
          "Prices, store and mode belong to the offer and its purchase terms. A retry must not silently charge a changed price.",
        ],
        links: [
          { label: "Hosted checkout for server-created orders", slug: "collect/hosted-checkout" },
        ],
      },
    ],
  },
  {
    slug: "collect/hosted-checkout",
    group: "Collect payments",
    title: "Hosted checkout",
    description: "Send customers to a Forwend payment page for one purchase attempt.",
    next: "collect/embedded-checkout",
    sections: [
      {
        id: "create",
        title: "Create on the server",
        paragraphs: [
          "Create a checkout session with a store, server-calculated amount and your order reference. The response includes payment.hostedUrl.",
          "Checkout sessions do not issue an invoice number or invoice document. Keep the session ID in your order record.",
        ],
        code: { language: "JavaScript", code: CHECKOUT_REQUEST },
      },
      {
        id: "return",
        title: "Return and confirm",
        paragraphs: [
          "Link to the returned hosted URL. A returnUrl can take the customer back after checkout; the URL must use HTTPS and an approved store origin.",
          "Treat a return as navigation. Verify signed payment events and read canonical status on your server before shipping.",
        ],
        links: [
          { label: "First test payment", slug: "start/first-test-payment" },
          { label: "Checkout-session reference", slug: "api/checkout-sessions" },
        ],
      },
    ],
  },
  {
    slug: "collect/embedded-checkout",
    group: "Collect payments",
    title: "Embedded checkout",
    description: "Place the full checkout or just the payment panel inside your site.",
    previous: "collect/hosted-checkout",
    next: "integrate/webhooks",
    sections: [
      {
        id: "origins",
        title: "Allow your application origin",
        paragraphs: [
          "Add your site’s exact origin in the store settings before embedding. HTTPS is required outside test loopback development.",
          "Create the session on your server. Extract its pay token from the returned payment.hostedUrl and pass only that public token to the browser.",
          "The iframe stays on Forwend’s origin. Browser packages check message origin and source, but messages remain display hints.",
        ],
      },
      {
        id: "react",
        title: "Use the React components",
        paragraphs: [
          "Checkout includes the order summary. PaymentElement shows only the payment panel, for use beside your own summary. PayButton opens the hosted page.",
        ],
        code: { language: "TSX", code: REACT_CHECKOUT },
        links: [{ label: "Browser package details", slug: "integrate/browser-packages" }],
      },
      {
        id: "trust",
        title: "Keep fulfillment on your server",
        paragraphs: [
          "An onStatus callback can refresh your interface. It must never mark an order paid by itself.",
          "Verify a signed invoice.paid event and read the session again through the API. Validate its store, order reference, mode and amount before fulfilling once.",
        ],
      },
    ],
  },
  {
    slug: "integrate/authentication",
    group: "Integrate",
    title: "Authentication and keys",
    description: "Give your server only the permissions its integration needs.",
    next: "integrate/server-setup",
    sections: [
      {
        id: "create",
        title: "Create a secret key",
        paragraphs: [
          "In a freelancer or merchant profile, open Developers and create a key. This action needs a fresh sign-in. Copy its secret once and store it on your server.",
          "Send Authorization: Bearer fw_test_… on API requests. Never include this key in browser code, source control or a public environment variable.",
        ],
        fields: [
          {
            name: "invoices.read",
            type: "scope",
            description: "Read invoices, checkout sessions, payments and webhook events.",
          },
          {
            name: "invoices.write",
            type: "scope",
            description: "Create invoices and checkout sessions; expire unpaid checkout attempts.",
          },
          { name: "stores.read", type: "scope", description: "Read permitted stores." },
          {
            name: "tokens.read",
            type: "scope",
            description: "Read enabled token choices and profile switches.",
          },
        ],
      },
      {
        id: "scope",
        title: "Profile, store and mode",
        paragraphs: [
          "A key belongs to one profile. A merchant key is scoped to one store and cannot read another store’s invoices or events.",
          "Keys cannot move money, edit billing details or manage the team. Store creation and token settings remain app actions.",
        ],
      },
      {
        id: "rotate",
        title: "Replace or revoke a key",
        paragraphs: [
          "Roll a key to replace it while allowing an overlap of up to seven days. Revoke it to stop access immediately.",
          "An expired, revoked or incorrect key returns invalid_api_key. Missing permissions return forbidden.",
        ],
      },
    ],
  },
  {
    slug: "integrate/server-setup",
    group: "Integrate",
    title: "Server setup",
    description: "Use the published Node package for invoices, or call the HTTP API directly.",
    previous: "integrate/authentication",
    next: "start/first-test-payment",
    sections: [
      {
        id: "install",
        title: "Install the Node package",
        paragraphs: [
          "forwend 0.1.0 requires Node 20 or later and has no runtime dependencies. Published methods are invoices.create/get/list and webhookEvents.list, plus verifyWebhook.",
          "Checkout-session and payment methods exist in the repository but are not in the published 0.1.0 package. Use HTTP for those operations.",
        ],
        code: { language: "Shell", code: "npm install forwend@0.1.0" },
      },
      {
        id: "client",
        title: "Create an invoice",
        code: { language: "TypeScript", code: INVOICE_REQUEST },
      },
      {
        id: "errors",
        title: "Handle errors and pagination",
        paragraphs: [
          "The client throws ForwendError with status and code for API errors. Act on code, not message text.",
          "Invoice and webhook-event lists are async iterables. Iterate with for await to request further pages. The client generates a create idempotency key when omitted; supply your own stable order key for retries across process restarts.",
        ],
        links: [
          { label: "Error reference", slug: "reference/errors" },
          { label: "Idempotency and pages", slug: "reference/request-rules" },
        ],
      },
    ],
  },
  {
    slug: "integrate/browser-packages",
    group: "Integrate",
    title: "Browser packages",
    description: "Public payment tokens belong in the browser. Secret API keys do not.",
    sections: [
      {
        id: "react",
        title: "React 18 and 19",
        paragraphs: [
          "@forwend/react 0.1.0 exports Checkout, PaymentElement and PayButton. Install it alongside your existing React application.",
        ],
        code: { language: "Shell", code: "npm install @forwend/react@0.1.0" },
        links: [{ label: "React component examples", slug: "collect/embedded-checkout" }],
      },
      {
        id: "javascript",
        title: "Plain JavaScript",
        paragraphs: [
          "@forwend/js 0.1.0 exports mountCheckout, payUrl and linkUrl. mountCheckout returns an instance with destroy() for cleanup.",
        ],
        code: {
          language: "JavaScript",
          code: `import { mountCheckout } from "@forwend/js";\n\nconst container = document.querySelector("#checkout");\nif (container) {\n  const checkout = mountCheckout(container, { payToken });\n  // When removing this view:\n  // checkout.destroy();\n}`,
        },
      },
      {
        id: "values",
        title: "Keep public and secret values separate",
        points: [
          "payToken identifies the hosted payment page and can be passed to a customer.",
          "The store’s allowed origins decide which sites may embed its checkout.",
          "FORWEND_KEY and FORWEND_WEBHOOK_SECRET stay on your server.",
          "Callbacks update presentation only; confirm payment through the server API.",
        ],
      },
    ],
  },
  {
    slug: "integrate/payment-status",
    group: "Integrate",
    title: "Payment status",
    description:
      "A transfer being seen, a payment being confirmed and money reaching your wallet are different facts.",
    sections: [
      {
        id: "states",
        title: "Read payment and settlement separately",
        fields: [
          {
            name: "paymentStatus",
            type: "string",
            description:
              "open, detected, partially_paid, paid, expired, expired_partially_paid or canceled.",
          },
          {
            name: "confirming",
            type: "boolean",
            description: "Observed money is still waiting for required network confirmation.",
          },
          {
            name: "settlementStatus",
            type: "string",
            description:
              "none, pending or settled. This describes transfer into the profile wallet.",
          },
          {
            name: "refundStatus",
            type: "string",
            description:
              "Separate held-money and refund processing; never treat it as payment revenue.",
          },
        ],
        paragraphs: [
          "Confirmed is a human explanation, not a paymentStatus value or an invoice.confirmed webhook. invoice.paid reports paid status; invoice.settled reports settlement.",
        ],
      },
      {
        id: "fulfillment",
        title: "Fulfill from verified state",
        points: [
          "Verify the signature and timestamp of each event before accepting it.",
          "Save event IDs durably and process each once. Events can arrive out of order.",
          "Read the matching invoice or checkout session from the API using your server key.",
          "Match your order’s ID, reference, store, mode and expected money before fulfilling once.",
          "Wait for paid; detected, confirming and partially_paid do not mean the full order has been paid.",
        ],
        paragraphs: [
          "A network reorganization can remove an observed transfer. Late payments and excess money can be held for the payer instead of credited to the business.",
        ],
      },
    ],
  },
  {
    slug: "integrate/webhooks",
    group: "Integrate",
    title: "Webhooks and verification",
    description:
      "Receive signed payment events, then confirm current payment state before fulfilling an order.",
    previous: "start/first-test-payment",
    next: "api/webhook-events",
    sections: [
      {
        id: "setup",
        title: "Register an endpoint",
        paragraphs: [
          "Open Developers, add an HTTPS endpoint and choose events. A merchant endpoint can cover one store or all its stores.",
          "Saving an endpoint, revealing its secret or rotating that secret requires a fresh sign-in. Keep the whsec_ secret on your server.",
        ],
      },
      {
        id: "verify",
        title: "Verify the unmodified request body",
        paragraphs: [
          "Read the raw body before JSON parsing. verifyWebhook checks webhook-id, webhook-timestamp and webhook-signature with your signing secret.",
          "The signature is v1, followed by base64 HMAC-SHA256 of id.timestamp.body. The key is the base64 secret after whsec_. A timestamp more than five minutes away is rejected.",
        ],
        code: { language: "TypeScript", code: WEBHOOK_VERIFY },
      },
      {
        id: "processing",
        title: "Acknowledge safely",
        points: [
          "The example verifies a signature only. Add durable queuing and fulfillment checks before using it to process orders.",
          "Store event.id with a uniqueness constraint. A retry is the same event, not another payment.",
          "Compare sequence for each invoice. Do not apply an older event over newer state.",
          "The invoice reflects its state when the first delivery body is produced. Retries retain those bytes. Fetch canonical state before fulfilling.",
          "Acknowledge with a 2xx response within 15 seconds, after persisting the event for processing.",
        ],
      },
      {
        id: "retries",
        title: "Retries and secret rotation",
        paragraphs: [
          "A failed response, timeout or redirect is retried after 5 seconds, 5 minutes, 30 minutes, 2 hours and 5 hours, then every 10 hours: 12 tries over about three days.",
          "HTTP 410 or the final failed attempt disables the endpoint. Inspect deliveries and re-enable it in Developers after fixing the cause.",
          "A rotated secret overlaps for 24 hours. During overlap the old and new signatures are both sent. Update your verifier before removing the old secret.",
        ],
        links: [{ label: "Event types and listing API", slug: "api/webhook-events" }],
      },
    ],
  },
];
