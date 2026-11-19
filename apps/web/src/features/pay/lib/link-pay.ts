import { OFFER_VERSION_PATTERN, USD_PATTERN } from "@/features/links/constants/links";
import type { PublicLink } from "@/features/links/types/links";
import { LINK_PAY_COPY as COPY } from "@/features/pay/constants/pay-copy";
import type { LinkPurchase } from "@/features/pay/types/link-pay";
import { usdCents } from "@/shared/lib/money";

const purchaseKey = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:([0-9]{1,14})$/;
const INT64_MAX = 9223372036854775807n;
const LEAST_CENTS = 100n; // 1.00 USD

/** The URL keeps an uncertain Pay across reloads, so a retry reuses its idempotency key. */
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
    (!OFFER_VERSION_PATTERN.test(offerVersion) || BigInt(offerVersion) > INT64_MAX)
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

export function checkLinkAmount(
  link: Pick<PublicLink, "amountUsd" | "minUsd" | "maxUsd">,
  typed: string | null,
): { cents: bigint; error: string } {
  const amount = link.amountUsd ?? typed ?? "";
  const cents = USD_PATTERN.test(amount) ? usdCents(amount) : 0n;
  if (cents === 0n) return { cents, error: COPY.errors.amount };
  const outside =
    cents < LEAST_CENTS ||
    (link.minUsd !== null && cents < usdCents(link.minUsd)) ||
    (link.maxUsd !== null && cents > usdCents(link.maxUsd));
  return {
    cents,
    error: outside ? COPY.errors.limits(COPY.amountHint(link.minUsd, link.maxUsd)) : "",
  };
}
