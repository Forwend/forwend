# forwend

The Forwend API for Node 20 or later, with no dependencies. It creates, reads and lists invoices, lists webhook
events page by page, and verifies webhooks.

```sh
npm install forwend
```

```ts
import { Forwend, verifyWebhook } from "forwend";

const forwend = new Forwend({
  apiKey: process.env.FORWEND_KEY ?? "",
  profileId: process.env.FORWEND_PROFILE_ID ?? "",
  baseUrl: "https://forwend.com/api",
});

const invoice = await forwend.invoices.create(
  { amountUsd: "1250.00", metadata: { order_id: "1042" } },
  { idempotencyKey: "order-1042" },
);

// In your webhook route, with the raw request body:
const event = verifyWebhook({ payload: rawBody, headers, secrets: [process.env.FORWEND_WEBHOOK_SECRET ?? ""] });
```

Every network is a testnet for now, so every key and invoice is in test mode. Docs: https://forwend.com/docs
