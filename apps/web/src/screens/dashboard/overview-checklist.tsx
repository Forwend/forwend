"use client";

import { useLinkWithPasskey, usePrivy } from "@privy-io/react-auth";
import { skipToken } from "@reduxjs/toolkit/query";
import { useState } from "react";
import { useGetInvoicesInfiniteQuery } from "@/features/invoices/api/invoices-api";
import { ChecklistCard } from "@/features/onboarding/components/checklist-card";
import { CHECKLIST_STEPS } from "@/features/onboarding/constants/onboarding";
import { CHECKLIST_COPY } from "@/features/onboarding/constants/onboarding-copy";
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
import { useGetTransactionsQuery } from "@/features/transactions/api/transactions-api";
import { TRANSACTIONS_PAGE_SIZE } from "@/features/transactions/constants/transactions";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";

const PASSKEY = "passkey";

// The checklist for a personal or freelancer overview (R-50, D-53), read from data the app already loads: the
// Privy account, billing details, the newest invoices page and the newest transfers (the notifications menu's
// query). A paid invoice older than the newest page does not count; by then the user is past their first steps.
export function OverviewChecklist() {
  const { profile, openReceive, openRequest } = useAppSession();
  const { profileId, kind } = profile;
  const { user } = usePrivy();
  const { linkWithPasskey } = useLinkWithPasskey();
  const [dismissal, setDismissal] = useState<ChecklistDismissal>(() => readDismissal(profileId));
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState("");
  const freelancer = kind === PROFILE_KINDS.freelancer;
  const open = !dismissal.closed;
  const billing = useGetBillingDetailsQuery(open && freelancer ? profileId : skipToken);
  const invoices = useGetInvoicesInfiniteQuery(open ? { profileId } : skipToken, LIVE_QUERY);
  const transactions = useGetTransactionsQuery(
    open ? { profileId, limit: TRANSACTIONS_PAGE_SIZE } : skipToken,
    LIVE_QUERY,
  );

  if (kind === PROFILE_KINDS.merchant || !open || !user) return null;
  if (!invoices.data || !transactions.data || (freelancer && billing.data === undefined))
    return null;
  const steps = checklistSteps(kind, {
    passkeyLinked: user.linkedAccounts.some((account) => account.type === PASSKEY),
    hasBillingDetails: Boolean(billing.data),
    invoices: invoices.data.pages[0]?.items ?? [],
    transactions: transactions.data.items,
  });
  const shown = steps && visibleSteps(steps, dismissal);
  if (!shown) return null;

  const dismiss = (next: ChecklistDismissal) => {
    setDismissal(next);
    saveDismissal(profileId, next);
  };
  const addPasskey = async () => {
    setError("");
    setLinking(true);
    try {
      await linkWithPasskey();
    } catch {
      setError(CHECKLIST_COPY.passkeyFailed);
    } finally {
      setLinking(false);
    }
  };

  return (
    <ChecklistCard
      kind={kind}
      steps={shown}
      actions={{
        [CHECKLIST_STEPS.passkey]: { onClick: () => void addPasskey(), busy: linking },
        [CHECKLIST_STEPS.billingDetails]: { href: APP_ROUTES.billingDetails },
        [CHECKLIST_STEPS.firstInvoice]: freelancer
          ? { href: APP_ROUTES.newInvoice }
          : { onClick: openRequest },
        [CHECKLIST_STEPS.firstPaid]: { href: APP_ROUTES.invoices },
        [CHECKLIST_STEPS.firstMoney]: { onClick: openReceive },
      }}
      error={error}
      onSkip={(id: ChecklistStepId) =>
        dismiss({ ...dismissal, skipped: [...dismissal.skipped, id] })
      }
      onClose={() => dismiss({ ...dismissal, closed: true })}
    />
  );
}
