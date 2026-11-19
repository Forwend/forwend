// Privy rejects with only this message, no code, when the owner cancels the ask.
const MFA_CANCELLED = "MFA canceled";

export const mfaCancelled = (error: unknown) =>
  error instanceof Error && error.message === MFA_CANCELLED;
