import type { StepperStep } from "@forwend/ui-web";
import { useState } from "react";
import { flushSync } from "react-dom";

/** One group of fields at a time; every group stays mounted, so changing steps keeps what was typed. */
export function useFormSteps(steps: readonly StepperStep[]) {
  const [step, setStep] = useState(0);
  const at = steps[step]?.id;
  return {
    steps,
    step,
    setStep,
    at,
    last: step === steps.length - 1,
    shows: (id: string) => (at === id ? "contents" : "hidden"),
    focusError: (form: HTMLFormElement) => {
      const invalid = form.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid]');
      const id = invalid?.closest<HTMLElement>("[data-step]")?.dataset.step;
      const index = steps.findIndex((s) => s.id === id);
      if (index >= 0) flushSync(() => setStep(index));
      invalid?.focus();
    },
  };
}
