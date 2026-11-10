import { USD_PATTERN } from "@/features/links/constants/links";
import type { LinkPurchase } from "@/features/pay/types/link-pay";
import { usdCents } from "@/shared/lib/money";

const purchaseKey = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:([0-9]{1,14})$/;

/** The URL retains uncertain requests across reloads even when browser storage is unavailable. */
export function readPurchase(search: string): LinkPurchase | null {
  const params = new URLSearchParams(search);
  const key = params.get("purchase") ?? "";
  const match = purchaseKey.exec(key);
  const cents = match?.[1];
  if (!cents || BigInt(cents) === 0n) return null;
  const amountUsd = params.get("amount");
  const offerVersion = params.get("offer");
  if (
    offerVersion !== null &&
    (!/^[1-9][0-9]{0,18}$/.test(offerVersion) || BigInt(offerVersion) > 9223372036854775807n)
  )
    return null;
  if (amountUsd !== null && (!USD_PATTERN.test(amountUsd) || usdCents(amountUsd) !== BigInt(cents)))
    return null;
  return { idempotencyKey: key, cents, amountUsd, offerVersion };
}

export function purchaseSearch(current: string, purchase: LinkPurchase | null): string {
  const params = new URLSearchParams(current);
  params.delete("purchase");
  params.delete("amount");
  params.delete("offer");
  if (purchase) {
    params.set("purchase", purchase.idempotencyKey);
    if (purchase.amountUsd !== null) params.set("amount", purchase.amountUsd);
    if (purchase.offerVersion !== null) params.set("offer", purchase.offerVersion);
  }
  return params.toString();
}
