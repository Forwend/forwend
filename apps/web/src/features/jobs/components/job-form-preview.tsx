import { formatUsd } from "@/features/balances/lib/balances";
import { JOBS_COPY } from "@/features/jobs/constants/jobs-copy";
import { paymentCents } from "@/features/jobs/lib/jobs";
import type { PaymentDraft } from "@/features/jobs/types/jobs";
import { FormPreview } from "@/shared/components/step-form";
import { MONEY_COPY } from "@/shared/constants/money-copy";

const COPY = JOBS_COPY.form;

export interface JobFormPreviewProps {
  typed: { title: string; scope: string; client: string };
  payments: PaymentDraft[];
  deposit: boolean;
  total: bigint;
}

export function JobFormPreview({ typed, payments, deposit, total }: JobFormPreviewProps) {
  return (
    <FormPreview title={COPY.preview.title} note={COPY.preview.note}>
      <div className="flex flex-col gap-4 rounded-md bg-surface p-5 text-sm shadow-sm ring-1 ring-line">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted">
            {COPY.preview.for(typed.client || COPY.preview.noClient)}
          </p>
          <p
            className={`text-lg font-semibold break-words ${typed.title ? "text-ink" : "text-subtle"}`}
          >
            {typed.title || COPY.preview.noTitle}
          </p>
          {typed.scope ? (
            <p className="line-clamp-4 break-words whitespace-pre-line text-muted">{typed.scope}</p>
          ) : null}
        </div>
        <ol className="divide-y divide-line border-t border-line">
          {payments.map((p, i) => {
            const cents = paymentCents(p.amount);
            return (
              <li key={p.id} className="flex items-start justify-between gap-4 py-2.5">
                <span className="min-w-0">
                  <span className="block break-words text-ink">
                    {p.title.trim() || COPY.paymentTitle(i + 1)}
                  </span>
                  <span className="block text-xs text-muted">
                    {i === 0 && deposit
                      ? COPY.preview.onAccept
                      : COPY.preview.due(p.dueDays || "—")}
                  </span>
                </span>
                <span className="shrink-0 text-ink tabular-nums">
                  {cents === null ? "—" : `${formatUsd(cents)} ${MONEY_COPY.usd}`}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="flex items-baseline justify-between gap-4 border-t border-line pt-3">
          <span className="text-muted">{COPY.total}</span>
          <span className="font-semibold text-ink tabular-nums">
            {formatUsd(total)} {MONEY_COPY.usd}
          </span>
        </p>
      </div>
    </FormPreview>
  );
}
