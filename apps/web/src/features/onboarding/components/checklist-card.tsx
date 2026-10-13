"use client";

import { Button, buttonClasses, IconButton } from "@forwend/ui-web";
import { Check, X } from "lucide-react";
import Link from "next/link";
import { CHECKLIST_STEPS } from "@/features/onboarding/constants/onboarding";
import { CHECKLIST_COPY as COPY } from "@/features/onboarding/constants/onboarding-copy";
import type { ChecklistStep, ChecklistStepId } from "@/features/onboarding/types/onboarding";
import type { PROFILE_KINDS } from "@/features/profiles/constants/profile";

/** Where a step's button goes: a page, or something that opens here. */
export type StepAction = { href: string } | { onClick: () => void; busy?: boolean };

type ChecklistKind = typeof PROFILE_KINDS.personal | typeof PROFILE_KINDS.freelancer;

function stepCopy(id: ChecklistStepId, kind: ChecklistKind) {
  switch (id) {
    case CHECKLIST_STEPS.firstInvoice:
    case CHECKLIST_STEPS.firstPaid:
      return COPY.steps[id][kind];
    default:
      return COPY.steps[id];
  }
}

export interface ChecklistCardProps {
  kind: ChecklistKind;
  steps: readonly ChecklistStep[];
  actions: Record<ChecklistStepId, StepAction>;
  /** A step's failure, shown under the list. */
  error: string;
  onSkip: (id: ChecklistStepId) => void;
  onClose: () => void;
}

// R-50: the profile's first steps, each done or not from its data, with a way to do it or skip it.
export function ChecklistCard({
  kind,
  steps,
  actions,
  error,
  onSkip,
  onClose,
}: ChecklistCardProps) {
  const done = steps.filter((s) => s.done).length;
  return (
    <section
      aria-labelledby="checklist-title"
      className="flex flex-col rounded-md border border-line bg-surface"
    >
      <div className="flex items-center gap-3 border-b border-line py-2 pr-2 pl-4 sm:pl-5">
        <h2 id="checklist-title" className="text-base font-semibold text-ink">
          {COPY.title}
        </h2>
        <span className="text-sm text-muted">{COPY.progress(done, steps.length)}</span>
        <IconButton label={COPY.close} onClick={onClose} className="ml-auto">
          <X aria-hidden className="size-[var(--fw-icon-sm)]" />
        </IconButton>
      </div>
      <ol className="divide-y divide-line">
        {steps.map((step) => {
          const text = stepCopy(step.id, kind);
          const action = actions[step.id];
          return (
            <li
              key={step.id}
              className={`flex flex-wrap items-center gap-x-4 gap-y-3 px-4 sm:flex-nowrap sm:px-5 ${step.done ? "py-2" : "py-3"}`}
            >
              <span
                className={`grid size-6 shrink-0 place-items-center rounded-pill border ${
                  step.done ? "border-primary bg-primary text-on-primary" : "border-line-strong"
                }`}
              >
                {step.done ? <Check aria-hidden className="size-3.5" /> : null}
                <span className="sr-only">{step.done ? COPY.done : COPY.notDone}</span>
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={`font-medium ${step.done ? "text-muted" : "text-ink"}`}>
                  {text.title}
                </span>
                {/* A finished step keeps only its title, so the steps left stand out. */}
                {step.done ? null : <span className="text-sm text-muted">{text.hint}</span>}
              </div>
              {step.done ? null : (
                <div className="flex w-full items-center gap-1 pl-10 sm:w-auto sm:shrink-0 sm:pl-0">
                  {"href" in action ? (
                    <Link
                      href={action.href}
                      className={`${buttonClasses({ variant: "secondary", size: "sm" })} max-sm:h-11`}
                    >
                      {text.action}
                    </Link>
                  ) : (
                    <Button
                      size="sm"
                      className="max-sm:h-11"
                      variant="secondary"
                      loading={action.busy}
                      onClick={action.onClick}
                    >
                      {text.action}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="max-sm:h-11"
                    variant="ghost"
                    aria-label={COPY.skipStep(text.title)}
                    onClick={() => onSkip(step.id)}
                  >
                    {COPY.skip}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {error ? (
        <p role="alert" className="border-t border-line px-4 py-3 text-sm text-danger sm:px-5">
          {error}
        </p>
      ) : null}
    </section>
  );
}
