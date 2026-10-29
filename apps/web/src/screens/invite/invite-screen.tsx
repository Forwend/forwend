"use client";

import { Logo } from "@forwend/ui-web";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { SignInForm } from "@/features/auth/components/sign-in-form";
import { AUTH_COPY } from "@/features/auth/constants/auth-copy";
import { AcceptInvite, InviteSkeleton } from "@/features/team/components/accept-invite";
import { INVITE_COPY } from "@/features/team/constants/team-copy";
import { APP_ROUTES } from "@/shared/config/routes";

/** The page a team invite email opens (R-139): sign in, then accept. */
export function InviteScreen({ token }: { token: string }) {
  const { ready, authenticated } = usePrivy();
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-6xl flex-col gap-8 bg-bg fw-safe-x pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))] lg:py-10">
      <Link
        href={APP_ROUTES.site}
        className="self-start rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-focus"
      >
        <Logo />
      </Link>
      <main className="grid flex-1 place-items-center">
        {!ready ? (
          <InviteSkeleton label={AUTH_COPY.checkingSignIn} />
        ) : authenticated ? (
          <AcceptInvite token={token} />
        ) : (
          <div className="flex w-full max-w-sm flex-col gap-6">
            <p className="rounded-md bg-surface-2 px-4 py-3 text-center text-sm text-ink">
              {INVITE_COPY.signInBody}
            </p>
            <SignInForm />
          </div>
        )}
      </main>
    </div>
  );
}
