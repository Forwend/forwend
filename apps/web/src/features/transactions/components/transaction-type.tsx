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

// R-109.
export function TransactionType({ profileId, t }: TransactionTypeProps) {
  const [label] = useLabelTransactionMutation();
  const toast = useToast();
  // The choice shows at once and the select keeps focus, until the list read after saving shows it.
  const [chosen, setChosen] = useState<string | null>(null);
  if (chosen !== null && chosen === t.classification) setChosen(null);
  const needsReview = !!t.payment?.policyException || !!t.payment?.unreconciled;
  if (t.invoice && !t.labelable)
    return (
      <Link
        href={`${APP_ROUTES.payments}/${t.invoice.invoiceId}`}
        className="font-medium text-ink underline underline-offset-2"
      >
        Transfer to wallet · {invoiceNumber(t.invoice.number)}
      </Link>
    );
  if (!t.labelable && t.payment)
    return (
      <Link
        href={`${APP_ROUTES.payments}/${t.payment.paymentId}`}
        className="font-medium text-ink underline underline-offset-2"
      >
        Transfer to wallet
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
      value={
        chosen ??
        (t.classification === TRANSACTION_CLASSES.paymentException
          ? TRANSACTION_CLASSES.unclassified
          : t.classification)
      }
      hint={needsReview ? COPY.classes[TRANSACTION_CLASSES.paymentException] : undefined}
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
