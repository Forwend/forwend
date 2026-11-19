import type { User } from "@privy-io/react-auth";
import { PRIVY_PASSKEY } from "@/features/auth/constants/sign-in";

/** The login email, or a Google-only account's Google address: where Forwend's own codes go. */
export function loginEmail(user: User | null): string | undefined {
  return user?.email?.address ?? user?.google?.email;
}

export function passkeyIds(user: User | null): string[] {
  return (user?.linkedAccounts ?? []).flatMap((a) =>
    a.type === PRIVY_PASSKEY ? [a.credentialId] : [],
  );
}
