"use client";

import { Button, buttonClasses, IconButton } from "@forwend/ui-web";
import { useLinkWithPasskey, usePrivy } from "@privy-io/react-auth";
import { skipToken } from "@reduxjs/toolkit/query";
import { X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useGetInvoicesInfiniteQuery } from "@/features/invoices/api/invoices-api";
import { CHECKLIST_STEPS } from "@/features/onboarding/constants/onboarding";
import { CHECKLIST_COPY as COPY } from "@/features/onboarding/constants/onboarding-copy";
import {
  checklistSteps,
  readDismissal,
  saveDismissal,
  visibleSteps,
} from "@/features/onboarding/lib/onboarding";
import type { ChecklistDismissal, ChecklistStepId } from "@/features/onboarding/types/onboarding";
import { useGetBillingDetailsQuery } from "@/features/profiles/api/profiles-api";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import type { ProfileKind } from "@/features/profiles/types/profile";
import { useGetTransactionsQuery } from "@/features/transactions/api/transactions-api";
import { TRANSACTIONS_PAGE_SIZE } from "@/features/transactions/constants/transactions";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";

const PASSKEY = "passkey";

type StepAction = { href: string } | { onClick: () => void; busy?: boolean };

function stepCopy(id: ChecklistStepId, kind: ProfileKind) {
  if (id === CHECKLIST_STEPS.firstInvoice || id === CHECKLIST_STEPS.firstPaid) {
    return COPY.steps[id][kind === PROFILE_KINDS.freelancer ? kind : PROFILE_KINDS.personal];
  }
  return COPY.steps[id];
}

// R-50, D-53: read from data the app already loads. A small card at the sidebar's foot (the phone's More sheet) shows
// the progress and only the next step, so setup never takes over the overview. It goes once every step is done.
export function SetupGuide() {
  const { profile, openReceive, openRequest } = useAppSession();
  const { profileId, kind } = profile;
  const { user } = usePrivy();
  const { linkWithPasskey } = useLinkWithPasskey();
  const [dismissal, setDismissal] = useState<ChecklistDismissal>(() => readDismissal(profileId));
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState("");
  const freelancer = kind === PROFILE_KINDS.freelancer;
  const open = !dismissal.closed && kind !== PROFILE_KINDS.merchant;
  const billing = useGetBillingDetailsQuery(open && freelancer ? profileId : skipToken);
  const invoices = useGetInvoicesInfiniteQuery(open ? { profileId } : skipToken, LIVE_QUERY);
  const transactions = useGetTransactionsQuery(
    open ? { profileId, limit: TRANSACTIONS_PAGE_SIZE } : skipToken,
    LIVE_QUERY,
  );

  if (!open || !user) return null;
  if (!invoices.data || !transactions.data || (freelancer && billing.data === undefined))
    return null;
  const steps = checklistSteps(kind, {
    passkeyLinked: user.linkedAccounts.some((account) => account.type === PASSKEY),
    hasBillingDetails: Boolean(billing.data),
    invoices: invoices.data.pages[0]?.items ?? [],
    transactions: transactions.data.items,
  });
  const shown = steps && visibleSteps(steps, dismissal);
  const next = shown?.find((step) => !step.done);
  if (!shown || !next) return null;
  const done = shown.filter((step) => step.done).length;

  const dismiss = (change: ChecklistDismissal) => {
    setDismissal(change);
    saveDismissal(profileId, change);
  };
  const addPasskey = async () => {
    setError("");
    setLinking(true);
    try {
      await linkWithPasskey();
    } catch {
      setError(COPY.passkeyFailed);
    } finally {
      setLinking(false);
    }
  };
  const text = stepCopy(next.id, kind);
  const action: StepAction =
    next.id === CHECKLIST_STEPS.passkey
      ? { onClick: () => void addPasskey(), busy: linking }
      : next.id === CHECKLIST_STEPS.billingDetails
        ? { href: APP_ROUTES.billingDetails }
        : next.id === CHECKLIST_STEPS.firstInvoice
          ? freelancer
            ? { href: APP_ROUTES.newInvoice }
            : { onClick: openRequest }
          : next.id === CHECKLIST_STEPS.firstPaid
            ? { href: APP_ROUTES.invoices }
            : { onClick: openReceive };

  return (
    <section aria-labelledby="setup-guide" className="rounded-lg border border-line bg-surface p-3">
      <div className="flex items-center gap-2">
        <h2 id="setup-guide" className="text-sm font-medium text-ink">
          {COPY.title}
        </h2>
        <span className="text-xs text-muted tabular-nums">{COPY.progress(done, shown.length)}</span>
        <IconButton
          label={COPY.close}
          size="xs"
          onClick={() => dismiss({ ...dismissal, closed: true })}
          className="ml-auto"
        >
          <X aria-hidden className="size-3.5" />
        </IconButton>
      </div>
      {/* One segment per step, so the count reads at a glance. */}
      <ol aria-hidden className="mt-2 flex gap-1">
        {shown.map((step) => (
          <li
            key={step.id}
            className={`h-1 flex-1 rounded-pill ${step.done ? "bg-ink" : step === next ? "bg-accent" : "bg-line"}`}
          />
        ))}
      </ol>
      <p className="mt-3 text-sm font-medium text-ink">{text.title}</p>
      <p className="mt-0.5 text-xs text-muted">{text.hint}</p>
      <div className="mt-3 flex items-center gap-1">
        {"href" in action ? (
          <Link href={action.href} className={buttonClasses({ variant: "secondary", size: "sm" })}>
            {text.action}
          </Link>
        ) : (
          <Button size="sm" variant="secondary" loading={action.busy} onClick={action.onClick}>
            {text.action}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          aria-label={COPY.skipStep(text.title)}
          onClick={() => dismiss({ ...dismissal, skipped: [...dismissal.skipped, next.id] })}
        >
          {COPY.skip}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
