"use client";

import { Button, Checkbox, IconButton, TextField } from "@forwend/ui-web";
import { Plus, X } from "lucide-react";
import { useId, useRef } from "react";
import { flushSync } from "react-dom";
import { formatUsd } from "@/features/balances/lib/balances";
import { JOB_LIMITS } from "@/features/jobs/constants/jobs";
import { JOBS_COPY } from "@/features/jobs/constants/jobs-copy";
import type { PaymentDraft, PaymentField } from "@/features/jobs/types/jobs";
import { FieldGroup } from "@/shared/components/field-group";
import { MONEY_COPY } from "@/shared/constants/money-copy";

const COPY = JOBS_COPY.form;
const GRID =
  "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_8rem_6rem_2.5rem]";

export interface PaymentScheduleFieldsProps {
  payments: PaymentDraft[];
  errors: Record<string, Partial<Record<PaymentField, string>>>;
  error?: string;
  total: bigint;
  deposit: boolean;
  onDeposit: (deposit: boolean) => void;
  onEdit: (id: string, field: PaymentField, value: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}

export function PaymentScheduleFields({
  payments,
  errors,
  error,
  total,
  deposit,
  onDeposit,
  onEdit,
  onAdd,
  onRemove,
}: PaymentScheduleFieldsProps) {
  const depositId = useId();
  const list = useRef<HTMLUListElement>(null);
  const focusRow = (row: number) =>
    list.current?.querySelectorAll("li")[row]?.querySelector("input")?.focus();
  return (
    <FieldGroup title={COPY.paymentsGroup}>
      <div className="flex flex-col gap-3">
        <div aria-hidden className={`${GRID} max-sm:hidden text-sm font-medium text-ink`}>
          <span>{COPY.paymentColumn}</span>
          <span>{COPY.amount}</span>
          <span>{COPY.dueDays}</span>
        </div>
        <ul ref={list} className="flex flex-col gap-4 sm:gap-3">
          {payments.map((p, i) => {
            const shown = errors[p.id] ?? {};
            return (
              <li key={p.id} className={GRID}>
                <TextField
                  label={COPY.paymentTitle(i + 1)}
                  value={p.title}
                  onChange={(event) => onEdit(p.id, "title", event.target.value)}
                  maxLength={JOB_LIMITS.paymentTitle}
                  autoComplete="off"
                  error={shown.title}
                  className="col-span-full sm:col-span-1 sm:[&>label]:sr-only"
                />
                <TextField
                  label={COPY.amount}
                  aria-label={COPY.amountOf(i + 1)}
                  value={p.amount}
                  onChange={(event) => onEdit(p.id, "amount", event.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  autoComplete="off"
                  error={shown.amount}
                  className="sm:[&>label]:sr-only"
                />
                <TextField
                  label={COPY.dueDays}
                  aria-label={COPY.dueDaysOf(i + 1)}
                  value={p.dueDays}
                  onChange={(event) => onEdit(p.id, "dueDays", event.target.value)}
                  inputMode="numeric"
                  autoComplete="off"
                  error={shown.dueDays}
                  className="sm:[&>label]:sr-only"
                />
                <IconButton
                  label={COPY.remove(i + 1)}
                  disabled={payments.length === 1}
                  onClick={() => {
                    flushSync(() => onRemove(p.id));
                    focusRow(Math.min(i, payments.length - 2));
                  }}
                  className="self-start max-sm:col-start-3 max-sm:row-start-2 max-sm:mt-7 sm:mt-0.5"
                >
                  <X aria-hidden className="size-[var(--fw-icon-sm)]" />
                </IconButton>
              </li>
            );
          })}
        </ul>
        <p className="text-sm text-muted">{COPY.dueDaysHint}</p>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={payments.length >= JOB_LIMITS.payments}
            onClick={() => {
              flushSync(onAdd);
              focusRow(payments.length);
            }}
          >
            <Plus aria-hidden className="size-[var(--fw-icon-sm)]" />
            {COPY.add}
          </Button>
          <p className="flex items-baseline gap-3 text-ink">
            <span className="text-sm text-muted">{COPY.total}</span>
            <span className="text-lg font-semibold tabular-nums">
              {formatUsd(total)} {MONEY_COPY.usd}
            </span>
          </p>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col">
        <Checkbox
          label={COPY.deposit}
          checked={deposit}
          onChange={(event) => onDeposit(event.target.checked)}
          aria-describedby={depositId}
        />
        <p id={depositId} className="text-sm text-muted">
          {COPY.depositHint}
        </p>
      </div>
    </FieldGroup>
  );
}
