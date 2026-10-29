import { AUTH_COPY } from "@/features/auth/constants/auth-copy";

export const SETTINGS_COPY = {
  title: AUTH_COPY.settings,
  yourAccount: "Your account",
  thisProfile: "This profile",
  account: {
    title: "Account and security",
    intro: "How you sign in, and where.",
    signInWith: "Sign-in methods",
    signInNote: "The ways you can sign in to Forwend. Codes go to your email.",
    deviceNote: "Where you're signed in now, and how to end every session.",
    current: "This device",
    methods: {
      email: "Email code",
      google: "Google",
      passkey: "Passkey",
    },
    passkeyMade: (where: string) => `Made on ${where}`,
    addPasskey: "Add a passkey",
    passkeyHint: "Sign in with your fingerprint, face or device PIN instead of a code.",
    passkeyFailed: "The passkey was not added. Try again.",
    passkeyAdded: "Passkey added",
    device: "Sessions",
    deviceHint: "Forwend can't list your other devices: it only knows this one.",
    signOut: "Sign out",
    everywhere: "Sign out of all devices",
    everywhereHint: "Ends every session, this one too. You sign in again with your email.",
  },
  billing: { title: "Billing details" },
  networks: { title: "Accepted assets" },
  notifications: { title: "Notifications" },
  team: { title: "Team" },
} as const;
