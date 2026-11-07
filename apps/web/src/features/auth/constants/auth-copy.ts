export const AUTH_COPY = {
  notConfigured: "Sign-in is not set up here: NEXT_PUBLIC_PRIVY_APP_ID is missing.",
  checkingSignIn: "Checking your sign-in",
  signOut: "Sign out",
  account: "Account",
  darkMode: "Dark mode",
  signedIn: "Signed in",
  soon: "Soon",
  settings: "Settings",
  passkeyOnDevice:
    "You already have a passkey for this account here: your device or password manager has it.",
} as const;

/** R-137: confirming it's you, in place, before a change that needs a sign-in from the last 15 minutes (D-63). */
export const FRESH_SIGN_IN_COPY = {
  title: "Confirm it's you",
  checkEmail: "Check your email",
  enterCode: (email: string) => `Enter the 6-digit code sent to ${email}.`,
  sending: "Sending a code…",
  codeLabel: "Code",
  confirm: "Confirm",
  notReceived: "Didn't get it?",
  resend: "Resend code",
  resendIn: (seconds: number) => `Resend in ${seconds}s`,
  sendFailed: "We couldn't send the code.",
  tooMany: (wait: string) => `Too many codes for now. Try again in ${wait}.`,
  /** A wait as the countdown reads it: seconds under a minute, else whole minutes rounded up. */
  wait: (seconds: number) => (seconds < 60 ? `${seconds}s` : `${Math.ceil(seconds / 60)} min`),
  tryAgain: "Try again",
  cancel: "Cancel",
  codeFailed: "That code is wrong or expired.",
  noEmail:
    "This change needs a sign-in with your email, and your account has none. Add an email to your account, then try again.",
  close: "Close",
} as const;

/** D-49: two-step verification with a passkey and an authenticator app, which Privy checks before it signs or
 * exports. */
export const TWO_STEP_COPY = {
  methods: { passkey: "Passkey", totp: "Authenticator app" },
  setUp: "Set up two-step verification",
  scanTitle: "Scan with your authenticator app",
  scan: "Google Authenticator, 1Password, Authy or any other app works.",
  qrLabel: "QR code for your authenticator app",
  openApp: "Open in authenticator app",
  noScan: "Can't scan it? Enter this key in the app:",
  copyKey: "Copy key",
  copied: "Copied",
  copyFailed: "Couldn't copy. Select the key instead.",
  saveKey: "Keep this key somewhere safe: with it you can add the app again on a new phone.",
  enterSetupCode: "Enter the 6-digit code the app shows.",
  turnOn: "Turn on",
  starting: "Getting your QR code…",
  startingTitle: "One moment",
  passkeyStarting: "Turning on your passkey…",
  createPasskeyTitle: "Create a passkey",
  createPasskeyBody: "Your device saves it. Sends then ask for your fingerprint, face or PIN.",
  createPasskey: "Create passkey",
  tapPasskeyTitle: "Use your passkey",
  tapPasskeyBody: "Choose the passkey on this device that sends should ask for.",
  createPasskeyInstead: "Create a passkey on this device instead",
  stepOf: (step: number, of: number) => `Step ${step} of ${of}`,
  startFailed: "We couldn't start the setup.",
  passkeyFailed: "Your passkey didn't confirm it. Try again.",
  savedTitle: "Two-step is on",
  recordFailed:
    "Forwend couldn't save it, so sends also ask for an emailed code. Try again, or later remove a method and set it up again.",
  on: "Two-step verification is on",
  passkeyTitle: "Confirm with your passkey",
  passkeyBody: "Your device will ask for your fingerprint, face or PIN.",
  usePasskey: "Continue with passkey",
  usePasskeyInstead: "Use passkey instead",
  useAppInstead: "Use authenticator app instead",
  codeTitle: "Enter your authentication code",
  codeBody: "Open your authenticator app and enter the code.",
  verify: "Verify",
  unsupportedTitle: "Two-step method not supported",
  codeLabel: "Authenticator code",
  wrongCode: "That code didn't work. Enter the newest one from your app.",
  tooManyTries: "Too many wrong tries. Cancel and start again.",
  timedOut: "This took too long. Cancel and start again.",
  failed: "We couldn't check it. Try again.",
  noMethod:
    "Your account confirms this with a method Forwend doesn't support. Set up a passkey or an authenticator app in Account and security.",
  tryAgain: "Try again",
  notNow: "Not now",
  cancel: "Cancel",
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
