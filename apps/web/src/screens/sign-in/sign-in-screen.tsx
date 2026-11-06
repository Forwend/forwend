"use client";

import { Spinner } from "@forwend/ui-web";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { SignInForm } from "@/features/auth/components/sign-in-form";
import { AUTH_COPY } from "@/features/auth/constants/auth-copy";
import { SIGN_IN_COPY } from "@/features/auth/constants/sign-in";
import { LandscapePage } from "@/shared/components/landscape-page/landscape-page";
import { APP_ROUTES } from "@/shared/config/routes";

export function SignInScreen() {
  const { ready, authenticated } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready && authenticated) router.replace(APP_ROUTES.home);
  }, [ready, authenticated, router]);

  return (
    <LandscapePage homeLabel={SIGN_IN_COPY.homeLabel}>
      {ready && !authenticated ? (
        <SignInForm />
      ) : (
        <div className="grid min-h-64 place-items-center">
          <Spinner label={AUTH_COPY.checkingSignIn} />
        </div>
      )}
    </LandscapePage>
  );
}
