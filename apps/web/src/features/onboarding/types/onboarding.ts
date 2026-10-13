import type { InvoiceSummary } from "@/features/invoices/types/invoices";
import type {
  CHECKLIST_STEPS,
  ONBOARDING_CHOICES,
} from "@/features/onboarding/constants/onboarding";
import type { Transaction } from "@/features/transactions/types/transactions";

export type OnboardingChoice = (typeof ONBOARDING_CHOICES)[keyof typeof ONBOARDING_CHOICES];

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

/** What this browser's viewer closed or skipped on a profile's checklist. */
export interface ChecklistDismissal {
  closed: boolean;
  skipped: readonly ChecklistStepId[];
}
