import { API_PAYMENT_STATUSES } from "@/features/activity/activity";
import type { InvoiceSummary } from "@/features/invoices/invoices";
import { PROFILE_KINDS, type Profile, type ProfileKind } from "@/features/profiles/profile";
import {
  TRANSACTION_DIRECTIONS,
  TRANSACTION_STATUSES,
  type Transaction,
} from "@/features/transactions/transactions";

/** First-run choices (apps/backend/api/openapi.yaml, OnboardingRequest), in the order the screen shows them. */
export const ONBOARDING_CHOICES = {
  receiveAndSend: "receive_and_send",
  getPaidByClients: "get_paid_by_clients",
  acceptBusinessPayments: "accept_business_payments",
  buildIntegration: "build_integration",
} as const;

export type OnboardingChoice = (typeof ONBOARDING_CHOICES)[keyof typeof ONBOARDING_CHOICES];

// After the first-run choice the app opens the profile made for the most specific use: freelancer (get paid by
// clients), then merchant (business payments or an integration), else the personal one.
const LANDING_ORDER: readonly ProfileKind[] = [
  PROFILE_KINDS.freelancer,
  PROFILE_KINDS.merchant,
  PROFILE_KINDS.personal,
];

/** The profile to open after the first-run choice: one it made (`before` is the list it started from), by kind. */
export function landingProfile(before: readonly Profile[], after: readonly Profile[]) {
  const made = after.filter((p) => !before.some((b) => b.profileId === p.profileId));
  for (const kind of LANDING_ORDER) {
    const found = made.find((p) => p.kind === kind);
    if (found) return found;
  }
  return after.find((p) => p.kind === PROFILE_KINDS.personal) ?? after[0];
}

/** Checklist steps, in the order the card lists them. */
export const CHECKLIST_STEPS = {
  passkey: "passkey",
  billingDetails: "billing_details",
  firstInvoice: "first_invoice",
  firstPaid: "first_paid",
  firstMoney: "first_money",
} as const;

export type ChecklistStepId = (typeof CHECKLIST_STEPS)[keyof typeof CHECKLIST_STEPS];

export interface ChecklistStep {
  id: ChecklistStepId;
  done: boolean;
}

/** What the steps are read from (D-53: never stored). */
export interface ChecklistFacts {
  passkeyLinked: boolean;
  /** Only asked for freelancer profiles. */
  hasBillingDetails: boolean;
  /** The newest page of the profile's invoices (a personal profile's requests). */
  invoices: readonly Pick<InvoiceSummary, "paymentStatus">[];
  /** The newest wallet transfers. */
  transactions: readonly Pick<Transaction, "direction" | "status">[];
}

/** The profile's steps, done or not; null for a profile kind without a checklist (merchant). */
export function checklistSteps(kind: ProfileKind, facts: ChecklistFacts): ChecklistStep[] | null {
  if (kind === PROFILE_KINDS.merchant) return null;
  const steps: ChecklistStep[] = [{ id: CHECKLIST_STEPS.passkey, done: facts.passkeyLinked }];
  if (kind === PROFILE_KINDS.freelancer) {
    steps.push({ id: CHECKLIST_STEPS.billingDetails, done: facts.hasBillingDetails });
  }
  steps.push(
    { id: CHECKLIST_STEPS.firstInvoice, done: facts.invoices.length > 0 },
    {
      id: CHECKLIST_STEPS.firstPaid,
      // Paid stays paid once settled; a partial payment is not paid.
      done: facts.invoices.some((inv) => inv.paymentStatus === API_PAYMENT_STATUSES.paid),
    },
    {
      id: CHECKLIST_STEPS.firstMoney,
      // Only a final transfer counts: one still confirming can be undone by a reorg.
      done: facts.transactions.some(
        (t) =>
          t.direction === TRANSACTION_DIRECTIONS.in && t.status === TRANSACTION_STATUSES.confirmed,
      ),
    },
  );
  return steps;
}

/** What this browser's viewer closed or skipped on a profile's checklist. */
export interface ChecklistDismissal {
  closed: boolean;
  skipped: readonly ChecklistStepId[];
}

/** The steps the card lists, or null when it hides: closed, or every step not skipped is done. */
export function visibleSteps(
  steps: readonly ChecklistStep[],
  dismissal: ChecklistDismissal,
): ChecklistStep[] | null {
  if (dismissal.closed) return null;
  const shown = steps.filter((s) => !dismissal.skipped.includes(s.id));
  return shown.some((s) => !s.done) ? shown : null;
}

// Per profile in this browser: a viewer's convenience, not product data.
const dismissalKey = (profileId: string) => `forwend:checklist:${profileId}`;

export function readDismissal(profileId: string): ChecklistDismissal {
  try {
    const saved = JSON.parse(localStorage.getItem(dismissalKey(profileId)) ?? "null");
    return {
      closed: saved?.closed === true,
      skipped: Array.isArray(saved?.skipped) ? saved.skipped : [],
    };
  } catch {
    // Storage blocked or unreadable: the whole checklist shows.
    return { closed: false, skipped: [] };
  }
}

export function saveDismissal(profileId: string, dismissal: ChecklistDismissal) {
  try {
    localStorage.setItem(dismissalKey(profileId), JSON.stringify(dismissal));
  } catch {
    // Storage blocked: the choice lasts for this page view.
  }
}
