import { COINGECKO_URL } from "@/features/prices/constants/prices";
import { PRICES_COPY } from "@/features/prices/constants/prices-copy";
import { pricesStatus } from "@/features/prices/lib/prices";
import type { TokenPrice } from "@/features/prices/types/prices";

const TIME = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const DAY_AND_TIME = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export interface PricesUpdatedProps {
  /** The answer's prices; undefined after a failed read, which shows as unavailable. */
  prices: readonly TokenPrice[] | undefined;
}

/** CoinGecko's attribution, which every page showing its prices needs, and when they were read. */
export function PricesUpdated({ prices }: PricesUpdatedProps) {
  const { updatedAt, stale } = pricesStatus(prices ?? [], Date.now());
  let when: string = PRICES_COPY.unavailable;
  if (updatedAt) {
    when = stale
      ? PRICES_COPY.stale(DAY_AND_TIME.format(Date.parse(updatedAt)))
      : PRICES_COPY.updated(TIME.format(Date.parse(updatedAt)));
  }
  return (
    <p className="text-xs text-muted">
      <a
        href={COINGECKO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-sm underline decoration-line underline-offset-4 outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
      >
        {PRICES_COPY.byCoinGecko}
      </a>
      {" · "}
      <span className={stale || !updatedAt ? "text-warning" : undefined}>{when}</span>
    </p>
  );
}
