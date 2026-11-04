"use client";

import { Spinner } from "@forwend/ui-web";
import { usePrivy } from "@privy-io/react-auth";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { SignInForm } from "@/features/auth/components/sign-in-form";
import { AUTH_COPY } from "@/features/auth/constants/auth-copy";
import { SIGN_IN_COPY } from "@/features/auth/constants/sign-in";
import { SiteBar, SiteBarRow, SiteBrand } from "@/shared/components/site-bar/site-bar";
import { APP_ROUTES } from "@/shared/config/routes";
import styles from "./sign-in.module.css";

export function SignInScreen() {
  const { ready, authenticated } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready && authenticated) router.replace(APP_ROUTES.home);
  }, [ready, authenticated, router]);

  return (
    <div className={`flex min-h-dvh flex-col bg-bg ${styles.page}`}>
      <div className={styles.landscape} aria-hidden="true">
        <Image
          src="/images/sign-in-day.webp"
          alt=""
          fill
          sizes="100vw"
          className={`${styles.art} ${styles.dayArt}`}
        />
        <Image
          src="/images/sign-in-night.webp"
          alt=""
          fill
          sizes="100vw"
          className={`${styles.art} ${styles.nightArt}`}
        />
        <div className={styles.fade} />
      </div>
      {/* Only the logo, placed and sized as in the landing's bar, so it does not move between the two pages. */}
      <SiteBar plain>
        <SiteBarRow>
          <SiteBrand label={SIGN_IN_COPY.homeLabel} />
        </SiteBarRow>
      </SiteBar>
      <main className={styles.main}>
        <div className="mx-auto w-full max-w-sm">
          {ready && !authenticated ? (
            <SignInForm />
          ) : (
            <div className="grid min-h-64 place-items-center">
              <Spinner label={AUTH_COPY.checkingSignIn} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
