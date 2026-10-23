import { API_PAYMENT_STATUSES } from "@/features/activity/constants/activity";
import { CHECKLIST_STEPS } from "@/features/onboarding/constants/onboarding";
import type {
  ChecklistDismissal,
  ChecklistFacts,
  ChecklistStep,
} from "@/features/onboarding/types/onboarding";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import type { Profile, ProfileKind } from "@/features/profiles/types/profile";
import {
  TRANSACTION_DIRECTIONS,
  TRANSACTION_STATUSES,
} from "@/features/transactions/constants/transactions";
import { APP_ROUTES } from "@/shared/config/routes";

const LANDING_ORDER: readonly ProfileKind[] = [
  PROFILE_KINDS.freelancer,
  PROFILE_KINDS.merchant,
  PROFILE_KINDS.personal,
];

export function landingProfile(before: readonly Profile[], after: readonly Profile[]) {
  const made = after.filter((p) => !before.some((b) => b.profileId === p.profileId));
  for (const kind of LANDING_ORDER) {
    const found = made.find((p) => p.kind === kind);
    if (found) return found;
  }
  return after.find((p) => p.kind === PROFILE_KINDS.personal) ?? after[0];
}

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

/** Only a path in this app: another site would make the link an open redirect. */
export function afterOnboarding(next: string | null): string {
  // Checked as the browser resolves it, so ".." or "//" can't step out of /app.
  const base = "http://forwend.invalid";
  let url: URL;
  try {
    url = new URL(next || APP_ROUTES.home, base);
  } catch {
    return APP_ROUTES.home; // not a URL at all ("http://[")
  }
  return url.origin === base &&
    /^\/app(\/|$)/.test(url.pathname) &&
    !url.pathname.startsWith(APP_ROUTES.onboarding)
    ? url.pathname + url.search
    : APP_ROUTES.home;
}
