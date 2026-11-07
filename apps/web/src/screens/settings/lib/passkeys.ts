import type { LinkedAccountWithMetadata } from "@privy-io/react-auth";
import { PRIVY_PASSKEY } from "@/features/onboarding/constants/onboarding";

export interface PasskeyRow {
  credentialId: string;
  /** The password manager that keeps it, when the browser says (iCloud Keychain, Google Password Manager). */
  name: string | null;
  /** The browser and system it was made on. */
  madeOn: string | null;
  added: Date | null;
  lastUsed: Date | null;
  /** Privy's second step (R-219): removing it leaves two-step on with nothing that can answer it. */
  twoStep: boolean;
}

const SIGN_IN_TYPES: readonly string[] = ["email", "google_oauth", PRIVY_PASSKEY];

/** The account's passkeys, newest first (R-217). */
export function passkeysOf(accounts: readonly LinkedAccountWithMetadata[]): PasskeyRow[] {
  return accounts
    .flatMap((a) =>
      a.type === PRIVY_PASSKEY
        ? [
            {
              credentialId: a.credentialId,
              name: a.authenticatorName ?? null,
              madeOn: [a.createdWithBrowser, a.createdWithOs].filter(Boolean).join(", ") || null,
              added: a.firstVerifiedAt,
              lastUsed: a.latestVerifiedAt,
              twoStep: a.enrolledInMfa,
            },
          ]
        : [],
    )
    .sort((x, y) => (y.added?.getTime() ?? 0) - (x.added?.getTime() ?? 0));
}

/** A passkey can go only while another way to sign in stays: Privy would leave the account with none. */
export function canRemovePasskey(accounts: readonly LinkedAccountWithMetadata[]): boolean {
  return accounts.filter((a) => SIGN_IN_TYPES.includes(a.type)).length > 1;
}
