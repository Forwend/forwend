"use client";

import { Logo, Spinner } from "@forwend/ui-web";
import { usePrivy } from "@privy-io/react-auth";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { SignInForm } from "@/features/auth/components/sign-in-form";
import { AUTH_COPY } from "@/features/auth/constants/auth-copy";
import { SIGN_IN_COPY } from "@/features/auth/constants/sign-in";
import { HERO_IMAGE, HERO_NIGHT_IMAGE } from "@/shared/assets/images";
import { APP_ROUTES } from "@/shared/config/routes";

// The landing hero's horizon, cropped to sky and mountains, fades into the page; the form stands alone below it.
export function SignInScreen() {
  const { ready, authenticated } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready && authenticated) router.replace(APP_ROUTES.home);
  }, [ready, authenticated, router]);

  return (
    <div className="flex min-h-dvh flex-col bg-bg lg:block">
      <div className="relative h-56 overflow-hidden sm:h-72 lg:h-[22rem]">
        <Image
          src={HERO_IMAGE.src}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-[50%_52%] dark:hidden"
        />
        <Image
          src={HERO_NIGHT_IMAGE.src}
          alt=""
          fill
          loading="eager"
          sizes="100vw"
          className="hidden object-cover object-[50%_52%] dark:block"
        />
        <div className="absolute inset-x-0 bottom-0 h-3/4 bg-[linear-gradient(to_bottom,transparent,var(--fw-bg)_85%)]" />
        <Link
          href={APP_ROUTES.site}
          aria-label={SIGN_IN_COPY.homeLabel}
          className="absolute top-6 left-6 rounded-pill lg:top-8 lg:left-10"
        >
          <Logo />
        </Link>
      </div>
      {/* Phones and tablets: the form is centered in the space below the band. */}
      <main className="relative -mt-10 flex flex-1 items-center px-6 pb-16 sm:-mt-16 lg:block">
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
