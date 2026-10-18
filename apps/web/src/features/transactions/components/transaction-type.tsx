"use client";

import { formatTokenAmount, SelectField, shortAddress, TONES, useToast } from "@forwend/ui-web";
import Link from "next/link";
import { useState } from "react";
import { invoiceNumber } from "@/features/invoices/lib/invoices";
import { useLabelTransactionMutation } from "@/features/transactions/api/transactions-api";
import {
  TRANSACTION_CLASSES,
  TRANSACTION_LABELS,
} from "@/features/transactions/constants/transactions";
import { TRANSACTIONS_COPY as COPY } from "@/features/transactions/constants/transactions-copy";
import type {
  Transaction,
  TransactionClass,
  TransactionLabel,
} from "@/features/transactions/types/transactions";
import { APP_ROUTES } from "@/shared/config/routes";
import { exactDigits } from "@/shared/lib/money";

const CONFLICT = 409;
const NOT_FOUND = 404;
const CHOICES = [TRANSACTION_CLASSES.unclassified, ...TRANSACTION_LABELS].map((value) => ({
  value,
  label: COPY.classes[value],
}));

export interface TransactionTypeProps {
  profileId: string;
  t: Transaction;
}

// R-109: what a transaction was. An invoice payment links its invoice; money in that Forwend can't classify takes the
// user's label from a select; anything else is plain text.
export function TransactionType({ profileId, t }: TransactionTypeProps) {
  const [label] = useLabelTransactionMutation();
  const toast = useToast();
  // The choice shows at once and the select keeps focus, until the list read after saving shows it.
  const [chosen, setChosen] = useState<string | null>(null);
  if (chosen !== null && chosen === t.classification) setChosen(null);
  if (t.invoice)
    return (
      <Link
        href={`${APP_ROUTES.invoices}/${t.invoice.invoiceId}`}
        className="font-medium text-ink underline underline-offset-2"
      >
        {COPY.invoicePaid(invoiceNumber(t.invoice.number), t.invoice.clientName)}
      </Link>
    );
  if (!t.labelable)
    return (
      <span className="text-muted">
        {COPY.classes[t.classification as TransactionClass] ?? t.classification}
      </span>
    );
  return (
    <SelectField
      label={COPY.typeOf(
        `${formatTokenAmount({
          baseUnits: BigInt(t.amount),
          decimals: t.decimals,
          fractionDigits: exactDigits(BigInt(t.amount), t.decimals),
        })} ${t.symbol}`,
        shortAddress(t.counterparty),
      )}
      hideLabel
      options={CHOICES}
      value={chosen ?? t.classification}
      className="w-40"
      onValueChange={async (value) => {
        setChosen(value);
        try {
          await label({
            profileId,
            transaction: t,
            label: value === TRANSACTION_CLASSES.unclassified ? null : (value as TransactionLabel),
          }).unwrap();
        } catch (failure) {
          setChosen(null);
          const status = (failure as { status?: unknown }).status;
          toast({
            tone: TONES.warning,
            title: status === CONFLICT || status === NOT_FOUND ? COPY.typeRefused : COPY.typeFailed,
          });
        }
      }}
    />
  );
}
