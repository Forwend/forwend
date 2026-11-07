import { SITE } from "@/shared/config/site";

export const API_ADDRESS = `${SITE.url}/api`;

export const CHECKOUT_REQUEST = `const response = await fetch(
  process.env.FORWEND_API_URL + "/v1/profiles/" +
    process.env.FORWEND_PROFILE_ID + "/checkout-sessions",
  {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.FORWEND_KEY,
      "Content-Type": "application/json",
      "Idempotency-Key": "order-1042-attempt-1",
    },
    body: JSON.stringify({
      storeId: process.env.FORWEND_STORE_ID,
      amountUsd: "1250.00",
      reference: "order-1042",
      metadata: { order_id: "1042" },
    }),
  },
);
if (!response.ok) throw new Error("Checkout could not be created");
const session = await response.json();
// Send only the hosted URL, or the pay token for an embedded checkout, to your browser.
const hostedUrl = session.payment.hostedUrl;
const payToken = session.payment.payToken;`;

export const INVOICE_REQUEST = `import { Forwend } from "forwend";

const forwend = new Forwend({
  apiKey: process.env.FORWEND_KEY!,
  profileId: process.env.FORWEND_PROFILE_ID!,
  baseUrl: process.env.FORWEND_API_URL!,
});

const invoice = await forwend.invoices.create(
  { amountUsd: "1250.00", metadata: { order_id: "1042" } },
  { idempotencyKey: "order-1042" },
);
const latest = await forwend.invoices.get(invoice.invoiceId);`;

export const WEBHOOK_VERIFY = `import { verifyWebhook } from "forwend";

export async function POST(request: Request) {
  const payload = await request.text();
  let event;
  try {
    event = verifyWebhook({
      payload,
      headers: request.headers,
      secrets: [process.env.FORWEND_WEBHOOK_SECRET!],
    });
  } catch {
    return new Response("Invalid webhook", { status: 400 });
  }
  // Persist event.id in your durable job queue before acknowledging.
  // Deduplicate by event.id; read canonical API state before fulfillment.
  // This example verifies only. Add your queue before using it for orders.
  return Response.json({ verifiedEventId: event.id });
}`;

export const REACT_CHECKOUT = `import { Checkout, PaymentElement, PayButton } from "@forwend/react";

export function OrderPayment({ payToken }: { payToken: string }) {
  return <Checkout payToken={payToken} />;
}

// Use PaymentElement beside your own order summary instead.
export function PaymentPanel({ payToken }: { payToken: string }) {
  return <PaymentElement payToken={payToken} />;
}

// Or link to the hosted page, without an embedded checkout.
export function HostedPayment({ payToken }: { payToken: string }) {
  return <PayButton payToken={payToken}>Pay with Forwend</PayButton>;
}`;
