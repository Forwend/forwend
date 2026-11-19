import { Button, DetailList, DetailRow } from "@forwend/ui-web";
import { Mail } from "lucide-react";
import type { ReactNode } from "react";
import { NEW_INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import { FieldGroup } from "@/shared/components/field-group";

export interface NewInvoiceReviewProps {
  rows: readonly { step: string; term: string; value: ReactNode }[];
  next: string;
  onEdit: (step: string) => void;
}

export function NewInvoiceReview({ rows, next, onEdit }: NewInvoiceReviewProps) {
  return (
    <FieldGroup title={COPY.reviewGroup}>
      <DetailList className="rounded-md border border-line">
        {rows.map((row) => (
          <DetailRow key={row.term} term={row.term}>
            <span className="flex items-baseline justify-end gap-3">
              <span className="min-w-0 break-words">{row.value || "—"}</span>
              <Button
                variant="link"
                aria-label={COPY.editStep(row.term)}
                onClick={() => onEdit(row.step)}
                className="shrink-0 text-xs"
              >
                {COPY.edit}
              </Button>
            </span>
          </DetailRow>
        ))}
      </DetailList>
      <p className="flex items-start gap-2.5 rounded-md bg-surface-2 px-3.5 py-3 text-sm text-muted">
        <Mail aria-hidden className="mt-0.5 size-[var(--fw-icon-sm)] shrink-0" />
        {next}
      </p>
    </FieldGroup>
  );
}
