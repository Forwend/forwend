// Labels used in more than one place.
export const CTA = {
  joinWaitlist: "Join waitlist",
} as const;

export const WAITLIST_COPY = {
  success: "You're on the list.",
  invalid: "Enter a full email address, like name@company.com.",
} as const;

/** How long the mock shows its submitting state, in ms. */
export const WAITLIST_MOCK_DELAY_MS = 600;

// One "@", something on both sides, a dot in the domain, no spaces. Enough for a sign-up form.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}
