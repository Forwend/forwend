"use client";

import { Button, Logo, Panel, Spinner } from "@forwend/ui-web";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { APP_COPY, APP_ROUTES } from "@/constants/app";

export default function SignInPage() {
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready && authenticated) router.replace(APP_ROUTES.home);
  }, [ready, authenticated, router]);

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4">
      <Panel className="flex w-full max-w-sm flex-col gap-4 p-8">
        <Logo />
        <h1 className="font-display text-2xl text-ink">{APP_COPY.signInTitle}</h1>
        <p className="text-muted">{APP_COPY.signInBody}</p>
        {ready && !authenticated ? (
          <Button onClick={() => login()}>{APP_COPY.signInButton}</Button>
        ) : (
          <Spinner label={APP_COPY.checkingSignIn} />
        )}
      </Panel>
    </main>
  );
}
