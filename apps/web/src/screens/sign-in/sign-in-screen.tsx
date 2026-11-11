"use client";

import { Spinner } from "@forwend/ui-web";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { SignInForm } from "@/features/auth/components/sign-in-form";
import { AUTH_COPY } from "@/features/auth/constants/auth-copy";
import { SIGN_IN_COPY } from "@/features/auth/constants/sign-in";
import { LandscapePage } from "@/shared/components/landscape-page/landscape-page";
import { APP_ROUTES } from "@/shared/config/routes";

export function SignInScreen() {
  const { ready, authenticated } = usePrivy();

  return (
    <LandscapePage homeLabel={SIGN_IN_COPY.homeLabel}>
      <Suspense fallback={null}>{ready && authenticated ? <SignedInRedirect /> : null}</Suspense>
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

function SignedInRedirect() {
  const searchParams = useSearchParams();
  // Privy's callback cleanup can cancel a pending navigation; finish it when the URL changes.
  return <OpenApp key={searchParams.toString()} />;
}

function OpenApp() {
  const router = useRouter();
  useEffect(() => {
    router.replace(APP_ROUTES.home);
  }, [router]);
  return null;
}
