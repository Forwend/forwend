// Privy rejects with only this message, no code, when the owner cancels Forwend's two-step step (useMfaStep).
const MFA_CANCELLED = "MFA canceled";

/** Whether an action failed because the owner closed the two-step prompt: nothing went wrong to show. */
export const mfaCancelled = (error: unknown) =>
  error instanceof Error && error.message === MFA_CANCELLED;
