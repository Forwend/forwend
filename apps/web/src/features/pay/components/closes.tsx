import { Clock } from "lucide-react";
import type { Invoice } from "@/features/invoices/types/invoices";
import { CLOSING_SOON_MS } from "@/features/pay/constants/pay";
import { PAY_COPY as COPY } from "@/features/pay/constants/pay-copy";
import { checkoutClosesAt, shortDuration } from "@/features/pay/lib/pay";
import { dateTime } from "@/shared/lib/dates";

export function Closes({ invoice, now }: { invoice: Invoice; now: number }) {
  const closesAt = new Date(checkoutClosesAt(invoice));
  return (
    <p
      className={`flex items-center gap-1.5 self-end text-sm max-lg:self-start ${closesAt.getTime() - now < CLOSING_SOON_MS ? "text-warning" : "text-muted"}`}
    >
      <Clock aria-hidden className="size-[var(--fw-icon-sm)]" />
      <time dateTime={closesAt.toISOString()} title={dateTime(closesAt.toISOString())}>
        {COPY.closesIn(shortDuration(closesAt.getTime() - now))}
      </time>
    </p>
  );
}
