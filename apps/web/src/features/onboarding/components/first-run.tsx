"use client";

import { Button, FreelancerIcon, Logo, MerchantIcon } from "@forwend/ui-web";
import { ArrowLeftRight, Check, Code } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useCompleteOnboardingMutation } from "@/features/onboarding/api/onboarding-api";
import { ONBOARDING_CHOICES } from "@/features/onboarding/constants/onboarding";
import { FIRST_RUN_COPY as COPY } from "@/features/onboarding/constants/onboarding-copy";
import { landingProfile } from "@/features/onboarding/lib/onboarding";
import type { OnboardingChoice } from "@/features/onboarding/types/onboarding";
import type { Profile } from "@/features/profiles/types/profile";

const ICONS = {
  [ONBOARDING_CHOICES.receiveAndSend]: ArrowLeftRight,
  [ONBOARDING_CHOICES.getPaidByClients]: FreelancerIcon,
  [ONBOARDING_CHOICES.acceptBusinessPayments]: MerchantIcon,
  [ONBOARDING_CHOICES.buildIntegration]: Code,
} as const;

const CHOICES = Object.values(ONBOARDING_CHOICES);

// R-50: asked once, while /v1/me has no onboardedAt. Continue with nothing picked is the same as Skip.
export function FirstRun({
  profiles,
  onDone,
}: {
  /** The user's profiles before the choice. */
  profiles: readonly Profile[];
  /** Gets the profile to open: the one made for the most specific use, else the personal one. */
  onDone: (profile: Profile) => void;
}) {
  const [complete] = useCompleteOnboardingMutation();
  const [picked, setPicked] = useState<OnboardingChoice[]>([]);
  const [busy, setBusy] = useState<"continue" | "skip" | null>(null);
  const [failed, setFailed] = useState(false);

  const send = async (choices: OnboardingChoice[], button: "continue" | "skip") => {
    setFailed(false);
    setBusy(button);
    try {
      const me = await complete(choices).unwrap();
      const profile = landingProfile(profiles, me.profiles);
      if (profile) onDone(profile);
    } catch {
      setFailed(true);
      setBusy(null);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send(picked, "continue");
  };
  const toggle = (choice: OnboardingChoice) =>
    setPicked((was) => (was.includes(choice) ? was.filter((c) => c !== choice) : [...was, choice]));

  return (
    <div className="min-h-dvh bg-bg">
      <header className="px-4 pt-6 sm:px-6 lg:px-10 lg:pt-8">
        <Logo />
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pt-10 pb-16 sm:px-6 sm:pt-16">
        <div className="flex flex-col gap-3">
          <h1 className="font-display text-3xl text-balance text-ink sm:text-4xl">{COPY.title}</h1>
          <p className="max-w-xl text-pretty text-muted">{COPY.intro}</p>
        </div>
        <form noValidate onSubmit={submit} className="flex flex-col gap-6">
          <fieldset>
            <legend className="sr-only">{COPY.legend}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {CHOICES.map((choice) => {
                const Icon = ICONS[choice];
                const text = COPY.choices[choice];
                return (
                  <label
                    key={choice}
                    className="group relative flex cursor-pointer border-line-strong flex-col items-start gap-1 rounded-md border bg-surface p-4 text-ink transition-[border-color,background-color] duration-[var(--fw-duration-fast)] hover:bg-surface-2 has-checked:border-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus sm:p-5"
                  >
                    <input
                      type="checkbox"
                      name="choices"
                      value={choice}
                      checked={picked.includes(choice)}
                      onChange={() => toggle(choice)}
                      aria-labelledby={`${choice}-title`}
                      aria-describedby={`${choice}-hint`}
                      className="sr-only"
                    />
                    <span
                      aria-hidden
                      className="absolute top-4 right-4 grid size-5 place-items-center rounded-sm border border-line-strong text-on-primary transition-colors duration-[var(--fw-duration-fast)] group-has-checked:border-primary group-has-checked:bg-primary sm:top-5 sm:right-5"
                    >
                      <Check className="size-3.5 opacity-0 group-has-checked:opacity-100" />
                    </span>
                    <Icon aria-hidden className="mb-2 size-[var(--fw-icon-lg)] text-accent" />
                    <span id={`${choice}-title`} className="pr-8 font-medium">
                      {text.title}
                    </span>
                    <span id={`${choice}-hint`} className="flex flex-col gap-2 text-sm text-muted">
                      {text.hint}
                      <span className="text-xs font-medium">{text.result}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={busy === "continue"} disabled={busy === "skip"}>
              {COPY.continue}
            </Button>
            <Button
              variant="ghost"
              loading={busy === "skip"}
              disabled={busy === "continue"}
              onClick={() => void send([], "skip")}
            >
              {COPY.skip}
            </Button>
          </div>
          <p role="alert" className="min-h-5 text-sm text-danger">
            {failed ? COPY.failed : ""}
          </p>
        </form>
      </main>
    </div>
  );
}
