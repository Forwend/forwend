import { formatDueDate } from "@/features/invoices/lib/invoices";
import { AMOUNT_KINDS, USD_PATTERN } from "@/features/links/constants/links";
import { LINKS_COPY as COPY } from "@/features/links/constants/links-copy";
import { amountLabel } from "@/features/links/lib/links";
import type { AmountKind, LinkField } from "@/features/links/types/links";
import { Payee } from "@/features/pay/components/payee";
import type { Store } from "@/features/stores/types/stores";
import { FormPreview } from "@/shared/components/step-form";

export interface LinkPreviewProps {
  typed: Record<LinkField, string>;
  kind: AmountKind;
  store: Store | undefined;
  endsAt: string | null;
  reusable: boolean;
  active: boolean;
}

export function LinkPreview({ typed, kind, store, endsAt, reusable, active }: LinkPreviewProps) {
  const amount =
    kind === AMOUNT_KINDS.fixed
      ? typed.amountUsd && USD_PATTERN.test(typed.amountUsd)
        ? amountLabel({ amountUsd: typed.amountUsd, minUsd: null, maxUsd: null })
        : COPY.preview.noAmount
      : amountLabel({
          amountUsd: null,
          minUsd: USD_PATTERN.test(typed.minUsd) ? typed.minUsd : null,
          maxUsd: USD_PATTERN.test(typed.maxUsd) ? typed.maxUsd : null,
        });
  const limits = [
    endsAt ? COPY.preview.until(formatDueDate(endsAt.slice(0, 10))) : null,
    !reusable
      ? COPY.preview.once
      : /^\d+$/.test(typed.maxPayments)
        ? COPY.preview.cap(Number(typed.maxPayments))
        : null,
  ].filter(Boolean);
  return (
    <FormPreview title={COPY.preview.title} note={COPY.preview.note}>
      <div className="flex flex-col gap-4 rounded-md bg-surface p-5 shadow-sm ring-1 ring-line">
        <Payee
          as="p"
          name={store?.name ?? (typed.title || COPY.preview.noTitle)}
          subtitle={COPY.preview.subtitle}
          brand={
            store ? { storeId: store.storeId, color: store.brandColor, logoAt: store.logoAt } : null
          }
        />
        <div className="flex flex-col gap-1 border-t border-line pt-4">
          {store ? (
            <p className={`font-medium break-words ${typed.title ? "text-ink" : "text-subtle"}`}>
              {typed.title || COPY.preview.noTitle}
            </p>
          ) : null}
          <p className="text-2xl font-medium tracking-tight text-ink tabular-nums">{amount}</p>
        </div>
        {limits.length || !active ? (
          <p className="border-t border-line pt-4 text-sm text-muted">
            {active ? limits.join(" · ") : COPY.preview.off}
          </p>
        ) : null}
      </div>
    </FormPreview>
  );
}
