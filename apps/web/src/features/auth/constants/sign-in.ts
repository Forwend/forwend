export const SIGN_IN_STEPS = {
  email: "email",
  code: "code",
} as const;

export const CODE_LENGTH = 6;

export const GOOGLE_PROVIDER = "google";

/** The fresh sign-in code route's error codes (apps/backend/api/openapi.yaml). */
export const FRESH_CODE_ERRORS = {
  sentRecently: "code_sent_recently",
  noLoginEmail: "no_login_email",
  tooMany: "too_many_codes",
} as const;

/** Privy's linked-account type for a passkey. */
export const PRIVY_PASSKEY = "passkey";
