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
  sentTo: (email: string) => `This change needs a recent sign-in. We sent a code to ${email}.`,
  sending: "This change needs a recent sign-in. Sending a code…",
  notSent: (email: string) =>
    `This change needs a recent sign-in. We couldn't send a code to ${email}.`,
  codeLabel: "Code",
  confirm: "Confirm",
  resend: "Send a new one",
  sendAgain: "Send a code",
  cancel: "Cancel",
  sendFailed: "We could not send a code. Try again.",
  codeFailed: "Wrong or expired code. Check it or send a new one.",
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
