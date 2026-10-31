import { forwend, webhookSecret } from "@/lib/forwend";
import { orders } from "@/lib/orders";
import { handleWebhook } from "@/lib/webhook";

// The raw body: a body parsed and written again would not match its signature.
export async function POST(request: Request) {
  try {
    const status = await handleWebhook(await request.text(), request.headers, {
      secret: webhookSecret(),
      orders: orders(),
      readSession: (id) => forwend().checkoutSessions.get(id),
    });
    return new Response(null, { status });
  } catch (error) {
    console.error("webhook not handled; Forwend sends it again", error);
    return new Response(null, { status: 500 });
  }
}
