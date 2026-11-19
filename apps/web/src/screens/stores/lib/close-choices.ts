import { DEFAULT_EXPIRY, EXPIRY_CHOICES } from "@/features/invoices/constants/invoices";
import { NEW_INVOICE_COPY } from "@/features/invoices/constants/invoices-copy";
import type { ExpiryChoice } from "@/features/invoices/types/invoices";

const CHOICES = Object.entries(EXPIRY_CHOICES) as [ExpiryChoice, number][];

/** New invoice's expiry choices, in seconds, for a store's default close. */
export const CLOSE_CHOICES = CHOICES.map(([choice, seconds]) => ({
  value: String(seconds),
  label: NEW_INVOICE_COPY.expiry[choice],
}));

export const DEFAULT_CLOSE = EXPIRY_CHOICES[DEFAULT_EXPIRY];

/** The API also takes other values; they show in minutes. */
export function closeLabel(seconds: number): string {
  const choice = CHOICES.find(([, value]) => value === seconds)?.[0];
  return choice ? NEW_INVOICE_COPY.expiry[choice] : `${Math.round(seconds / 60)} min`;
}
