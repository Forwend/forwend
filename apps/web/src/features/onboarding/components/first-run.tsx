"use client";

import { Button, ChoiceCard, Form, FreelancerIcon, Logo, MerchantIcon } from "@forwend/ui-web";
import { ArrowLeftRight, Code } from "lucide-react";
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

export interface FirstRunProps {
  /** The user's profiles before the choice. */
  profiles: readonly Profile[];
  /** Gets the profile to open: the one made for the most specific use, else the personal one. */
  onDone: (profile: Profile) => void;
}

// R-50: asked once, while /v1/me has no onboardedAt. Continue with nothing picked is the same as Skip.
export function FirstRun({ profiles, onDone }: FirstRunProps) {
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
        <Form onSubmit={submit}>
          <fieldset>
            <legend className="sr-only">{COPY.legend}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {CHOICES.map((choice) => {
                const text = COPY.choices[choice];
                return (
                  <ChoiceCard
                    key={choice}
                    type="checkbox"
                    name="choices"
                    value={choice}
                    checked={picked.includes(choice)}
                    onChange={() => toggle(choice)}
                    icon={ICONS[choice]}
                    title={text.title}
                    hint={
                      <>
                        {text.hint}
                        <span className="text-xs font-medium">{text.result}</span>
                      </>
                    }
                  />
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
        </Form>
      </main>
    </div>
  );
}
