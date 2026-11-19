"use client";

import { formatTokenAmount, SelectField, shortAddress, TONES, useToast } from "@forwend/ui-web";
import { useState } from "react";
import { useLabelTransactionMutation } from "@/features/transactions/api/transactions-api";
import {
  TRANSACTION_CLASSES,
  TRANSACTION_LABELS,
} from "@/features/transactions/constants/transactions";
import { TRANSACTIONS_COPY as COPY } from "@/features/transactions/constants/transactions-copy";
import { typeName } from "@/features/transactions/lib/transactions";
import type { Transaction, TransactionLabel } from "@/features/transactions/types/transactions";
import { notFound } from "@/shared/api/server-reach";
import { RecordLink } from "@/shared/components/record-link";
import { APP_ROUTES } from "@/shared/config/routes";
import { exactDigits } from "@/shared/lib/money";

const CONFLICT = 409;
const CHOICES = [TRANSACTION_CLASSES.unclassified, ...TRANSACTION_LABELS].map((value) => ({
  value,
  label: COPY.classes[value],
}));

export interface TransactionTypeProps {
  profileId: string;
  t: Transaction;
}

export function TransactionType({ profileId, t }: TransactionTypeProps) {
  const [label] = useLabelTransactionMutation();
  const toast = useToast();
  // The choice shows at once and the select keeps focus, until the list read after saving shows it.
  const [chosen, setChosen] = useState<string | null>(null);
  if (chosen !== null && chosen === t.classification) setChosen(null);
  const needsReview = !!t.payment?.policyException || !!t.payment?.unreconciled;
  if (!t.labelable) {
    // Money that paid a payment opens it: the invoice number and client, or a checkout's payment.
    const paid = t.invoice?.invoiceId ?? t.payment?.paymentId;
    return paid ? (
      <RecordLink href={`${APP_ROUTES.payments}/${paid}`}>{typeName(t)}</RecordLink>
    ) : (
      <span className="text-muted">{typeName(t)}</span>
    );
  }
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
          const refused =
            (failure as { status?: unknown }).status === CONFLICT || notFound(failure);
          toast({ tone: TONES.warning, title: refused ? COPY.typeRefused : COPY.typeFailed });
        }
      }}
    />
  );
}
