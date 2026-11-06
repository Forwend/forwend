export const AUTH_COPY = {
  notConfigured: "Sign-in is not set up here: NEXT_PUBLIC_PRIVY_APP_ID is missing.",
  checkingSignIn: "Checking your sign-in",
  signOut: "Sign out",
  account: "Account",
  darkMode: "Dark mode",
  signedIn: "Signed in",
  soon: "Soon",
  settings: "Settings",
} as const;

/** R-137: confirming it's you, in place, before a change that needs a sign-in from the last 15 minutes (D-63). */
export const FRESH_SIGN_IN_COPY = {
  title: "Confirm it's you",
  enterCode: (email: string) => `Enter the 6-digit code sent to ${email}.`,
  sending: "Sending a code…",
  codeLabel: "Code",
  confirm: "Confirm",
  notReceived: "Didn't get it?",
  resend: "Resend code",
  resendIn: (seconds: number) => `Resend in ${seconds}s`,
  sendFailed: "We couldn't send the code.",
  tryAgain: "Try again",
  cancel: "Cancel",
  codeFailed: "That code is wrong or expired.",
  noEmail:
    "This change needs a sign-in with your email, and your account has none. Add an email to your account, then try again.",
  close: "Close",
} as const;

/** R-137. */
export const SIGN_OUT_EVERYWHERE_COPY = {
  item: "Sign out everywhere",
  title: "Sign out everywhere?",
  body: "This signs you out on every device and browser, this one too. You sign in again with your email.",
  keep: "Keep me signed in",
  confirm: "Sign out everywhere",
  failed: "We could not sign you out everywhere. Try again.",
} as const;
