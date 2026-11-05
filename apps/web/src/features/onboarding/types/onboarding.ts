import type { z } from "zod";
import type { InvoiceSummary } from "@/features/invoices/types/invoices";
import type {
  CHECKLIST_STEPS,
  ONBOARDING_CHOICES,
  ONBOARDING_STEPS,
} from "@/features/onboarding/constants/onboarding";
import type { onboardingRequestSchema } from "@/features/onboarding/schemas/onboarding";
import type { Transaction } from "@/features/transactions/types/transactions";

export type OnboardingChoice = (typeof ONBOARDING_CHOICES)[keyof typeof ONBOARDING_CHOICES];

export type OnboardingRequest = z.infer<typeof onboardingRequestSchema>;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[keyof typeof ONBOARDING_STEPS];

/** What a details step collects for one new profile: its name and the billing details its invoices print. */
export interface ProfileDetails {
  name: string;
  email: string;
  country: string;
  address: string;
}

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

export interface ChecklistDismissal {
  closed: boolean;
  skipped: readonly ChecklistStepId[];
}
