import {
  CHECKLIST_STEPS,
  CHOICE_KINDS,
  ONBOARDING_STEPS,
} from "@/features/onboarding/constants/onboarding";
import type {
  ChecklistDismissal,
  ChecklistFacts,
  ChecklistStep,
  OnboardingChoice,
  OnboardingStep,
  ProfileDetails,
} from "@/features/onboarding/types/onboarding";
import { NEW_PROFILE_KINDS, PROFILE_KINDS } from "@/features/profiles/constants/profile";
import type { BillingDetailsBody } from "@/features/profiles/types/billing-details";
import type { NewProfileKind, Profile, ProfileKind } from "@/features/profiles/types/profile";
import {
  TRANSACTION_DIRECTIONS,
  TRANSACTION_STATUSES,
} from "@/features/transactions/constants/transactions";
import { APP_ROUTES } from "@/shared/config/routes";
import { API_PAYMENT_STATUSES } from "@/shared/constants/payment-state";

/** Two business choices share one merchant profile. */
export function newKinds(choices: readonly OnboardingChoice[]): NewProfileKind[] {
  const kinds = new Set<ProfileKind>(choices.map((choice) => CHOICE_KINDS[choice]));
  return NEW_PROFILE_KINDS.filter((kind) => kinds.has(kind));
}

export function onboardingSteps(
  choices: readonly OnboardingChoice[],
  passkeyLinked: boolean,
): OnboardingStep[] {
  const kinds = newKinds(choices);
  return [
    ONBOARDING_STEPS.use,
    ...(kinds.includes(PROFILE_KINDS.freelancer) ? [ONBOARDING_STEPS.freelancerDetails] : []),
    ...(kinds.includes(PROFILE_KINDS.merchant) ? [ONBOARDING_STEPS.merchantDetails] : []),
    ONBOARDING_STEPS.tokens,
    ...(passkeyLinked ? [] : [ONBOARDING_STEPS.passkey]),
    ONBOARDING_STEPS.ready,
  ];
}

export function billingBody(details: ProfileDetails): BillingDetailsBody {
  return {
    name: details.name.trim(),
    email: details.email.trim(),
    country: details.country,
    address: details.address.trim(),
    taxId: null,
  };
}

// Mirrors origin() in profile/stores.go, so the store save is never refused.
const ORIGIN =
  /^(?<scheme>https?):\/\/(?<host>[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)(?<port>:[0-9]{1,5})?\/?$/;

export function websiteOrigin(text: string): string | null {
  const groups = ORIGIN.exec(text.trim().toLowerCase())?.groups;
  if (!groups?.scheme || !groups.host) return null;
  const { scheme, host, port = "" } = groups;
  if (scheme === "https") return `https://${host}${port === ":443" ? "" : port}`;
  if (host === "localhost" || host === "127.0.0.1")
    return `http://${host}${port === ":80" ? "" : port}`;
  return null;
}

const RETURN_KEY = "forwend:onboarding:return";

export function rememberReturnPage(path: string) {
  try {
    sessionStorage.setItem(RETURN_KEY, path);
  } catch {
    // Storage blocked: the first run ends on the overview.
  }
}

export function takeReturnPage(): string {
  let path: string | null = null;
  try {
    path = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
  } catch {
    // Storage blocked: the overview.
  }
  return afterOnboarding(path);
}

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
      // A partial payment is not paid.
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
    return APP_ROUTES.home;
  }
  return url.origin === base &&
    /^\/app(\/|$)/.test(url.pathname) &&
    !url.pathname.startsWith(APP_ROUTES.onboarding)
    ? url.pathname + url.search
    : APP_ROUTES.home;
}
