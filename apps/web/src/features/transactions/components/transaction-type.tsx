"use client";

import { SelectField, shortAddress, TONES, useToast } from "@forwend/ui-web";
import { useState } from "react";
import { useLabelTransactionMutation } from "@/features/transactions/api/transactions-api";
import {
  TRANSACTION_CLASSES,
  TRANSACTION_LABELS,
} from "@/features/transactions/constants/transactions";
import { TRANSACTIONS_COPY as COPY } from "@/features/transactions/constants/transactions-copy";
import { typeName } from "@/features/transactions/lib/transactions";
import type { Transaction, TransactionLabel } from "@/features/transactions/types/transactions";
import { errorStatus, HTTP_STATUS, notFound } from "@/shared/api/api-error";
import { RecordLink } from "@/shared/components/record-link";
import { APP_ROUTES } from "@/shared/config/routes";
import { amountText } from "@/shared/lib/money";

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
  const [chosen, setChosen] = useState<string | null>(null);
  if (chosen !== null && chosen === t.classification) setChosen(null);
  const needsReview = !!t.payment?.policyException || !!t.payment?.unreconciled;
  if (!t.labelable) {
    const paid = t.invoice?.invoiceId ?? t.payment?.paymentId;
    return paid ? (
      <RecordLink href={`${APP_ROUTES.payments}/${paid}`}>{typeName(t)}</RecordLink>
    ) : (
      <span className="text-muted">{typeName(t)}</span>
    );
  }
  return (
    <SelectField
      label={COPY.typeOf(amountText(BigInt(t.amount), t), shortAddress(t.counterparty))}
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
          const refused = errorStatus(failure) === HTTP_STATUS.conflict || notFound(failure);
          toast({ tone: TONES.warning, title: refused ? COPY.typeRefused : COPY.typeFailed });
        }
      }}
    />
  );
}
