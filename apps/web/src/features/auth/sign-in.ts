export const SIGN_IN_STEPS = {
  email: "email",
  code: "code",
} as const;

/** Privy's email codes have 6 digits. */
export const CODE_LENGTH = 6;

/** The OAuth provider behind "Continue with Google". */
export const GOOGLE_PROVIDER = "google";

export const SIGN_IN_COPY = {
  homeLabel: "Forwend home",
  title: "Sign in to Forwend",
  intro: "New here? Signing in creates your account and wallet.",
  emailLabel: "Email",
  emailPlaceholder: "you@example.com",
  sendCode: "Email me a code",
  or: "or",
  google: "Continue with Google",
  passkey: "Sign in with passkey",
  codeTitle: "Check your email",
  codeSentTo: "Enter the 6-digit code we sent to",
  codeLabel: "Code",
  signIn: "Sign in",
  resend: "Send a new code",
  resent: "We sent a new code.",
  otherEmail: "Use another email",
  errors: {
    email: "Enter an email like name@example.com.",
    sendFailed: "We could not send the code. Try again.",
    code: "Enter all 6 digits.",
    codeFailed: "Wrong or expired code. Try again.",
    google: "Google sign-in did not finish. Try again.",
    passkey: "Passkey sign-in did not finish. Try again.",
  },
} as const;

export type SignInStep = (typeof SIGN_IN_STEPS)[keyof typeof SIGN_IN_STEPS];
