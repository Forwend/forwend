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

export function SignInScreen() {
  const { ready, authenticated } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready && authenticated) router.replace(APP_ROUTES.home);
  }, [ready, authenticated, router]);

  return (
    <div className="flex min-h-dvh flex-col bg-bg lg:block">
      <div className="relative h-44 overflow-hidden sm:h-64 lg:h-72">
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
          className="absolute top-[max(1.5rem,env(safe-area-inset-top))] left-[max(1.5rem,env(safe-area-inset-left))] rounded-md lg:top-8 lg:left-10"
        >
          <Logo />
        </Link>
      </div>
      {/* Phones and tablets: the form starts just under the band, overlapping its fade. */}
      <main className="relative -mt-10 flex flex-1 items-start pr-[max(1.5rem,env(safe-area-inset-right))] pl-[max(1.5rem,env(safe-area-inset-left))] pb-[calc(4rem+env(safe-area-inset-bottom))] sm:-mt-16 lg:block">
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
