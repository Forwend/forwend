export const AUTH_COPY = {
  notConfigured: "Sign-in is not set up here: NEXT_PUBLIC_PRIVY_APP_ID is missing.",
  checkingSignIn: "Checking your sign-in",
  notifications: "Email notifications",
  networks: "Networks and tokens",
  signOut: "Sign out",
  account: "Account",
  darkMode: "Dark mode",
  signedIn: "Signed in",
  soon: "Soon",
  settings: "Settings",
} as const;

/** R-137: the dialog before a change that needs a sign-in from the last 5 minutes (D-63). */
export const FRESH_SIGN_IN_COPY = {
  title: "Confirm it's you",
  intro: "This change needs a fresh sign-in.",
  sentTo: (email: string) => `We sent a code to ${email}. Enter it to go on.`,
  sending: "Sending a code…",
  codeLabel: "Code",
  confirm: "Confirm",
  resend: "Send a new code",
  cancel: "Cancel",
  sendFailed: "We could not send a code. Try again.",
  codeFailed: "That code didn't work. Check it or send a new one.",
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
