import type { z } from "zod";
import type { InvoiceSummary } from "@/features/invoices/types/invoices";
import type {
  CHECKLIST_STEPS,
  ONBOARDING_CHOICES,
  ONBOARDING_STEPS,
} from "@/features/onboarding/constants/onboarding";
import type { onboardingRequestSchema } from "@/features/onboarding/schemas/onboarding";
import type { BillingDetailsBody } from "@/features/profiles/types/billing-details";
import type { Transaction } from "@/features/transactions/types/transactions";

export type OnboardingChoice = (typeof ONBOARDING_CHOICES)[keyof typeof ONBOARDING_CHOICES];

export type OnboardingRequest = z.infer<typeof onboardingRequestSchema>;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[keyof typeof ONBOARDING_STEPS];

export type ProfileDetails = Omit<BillingDetailsBody, "taxId">;

export type ChecklistStepId = (typeof CHECKLIST_STEPS)[keyof typeof CHECKLIST_STEPS];

export interface ChecklistStep {
  id: ChecklistStepId;
  done: boolean;
}

export interface ChecklistFacts {
  passkeyLinked: boolean;
  hasBillingDetails: boolean;
  invoices: readonly Pick<InvoiceSummary, "paymentStatus">[];
  transactions: readonly Pick<Transaction, "direction" | "status">[];
}

export interface ChecklistDismissal {
  closed: boolean;
  skipped: readonly ChecklistStepId[];
}
