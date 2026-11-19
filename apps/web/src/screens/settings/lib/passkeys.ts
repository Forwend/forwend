import type { LinkedAccountWithMetadata } from "@privy-io/react-auth";
import { PRIVY_PASSKEY } from "@/features/onboarding/constants/onboarding";

export interface PasskeyRow {
  credentialId: string;
  name: string | null; // password manager, e.g. iCloud Keychain
  madeOn: string | null; // browser and system
  added: Date | null;
  lastUsed: Date | null;
  twoStep: boolean; // enrolled as Privy's second step
}

const SIGN_IN_TYPES: readonly string[] = ["email", "google_oauth", PRIVY_PASSKEY];

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
