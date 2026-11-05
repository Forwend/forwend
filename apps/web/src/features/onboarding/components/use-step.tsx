"use client";

import { Badge, ChoiceCard, FreelancerIcon, MerchantIcon } from "@forwend/ui-web";
import { ArrowLeftRight, Code } from "lucide-react";
import { ONBOARDING_CHOICES } from "@/features/onboarding/constants/onboarding";
import { FIRST_RUN_COPY } from "@/features/onboarding/constants/onboarding-copy";
import type { OnboardingChoice } from "@/features/onboarding/types/onboarding";

const COPY = FIRST_RUN_COPY.use;

const ICONS = {
  [ONBOARDING_CHOICES.receiveAndSend]: ArrowLeftRight,
  [ONBOARDING_CHOICES.getPaidByClients]: FreelancerIcon,
  [ONBOARDING_CHOICES.acceptBusinessPayments]: MerchantIcon,
  [ONBOARDING_CHOICES.buildIntegration]: Code,
} as const;

const CHOICES = Object.values(ONBOARDING_CHOICES);

export interface UseStepProps {
  picked: readonly OnboardingChoice[];
  onToggle: (choice: OnboardingChoice) => void;
}

/** What the user will do: any number of uses, each saying which profile it sets up. */
export function UseStep({ picked, onToggle }: UseStepProps) {
  return (
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
              onChange={() => onToggle(choice)}
              icon={ICONS[choice]}
              title={text.title}
              // Phones show the four uses at once: the title and the profile it makes say enough.
              hint={<span className="max-sm:hidden">{text.hint}</span>}
              tag={<Badge>{text.result}</Badge>}
            />
          );
        })}
      </div>
    </fieldset>
  );
}
