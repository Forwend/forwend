"use client";

import { Button, buttonClasses, Form, Stepper, type StepperStep } from "@forwend/ui-web";
import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import { type FormEvent, type ReactNode, useState } from "react";
import { flushSync } from "react-dom";
import { FlatFieldGroups } from "@/shared/components/field-group";

// From xl the form and its preview fill the screen below the page's intro: each scrolls on its own, so the footer's
// buttons stay in view. Narrower screens scroll the page, and the footer sticks above the phone tab bar.
export const SPLIT_CLASSES =
  "grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:h-[calc(100dvh-11.5rem)] xl:min-h-[32rem] xl:grid-cols-[minmax(0,40rem)_minmax(0,1fr)] xl:items-stretch xl:gap-10";
export const SPLIT_FORM_CLASSES = "min-h-0 xl:h-full";
/** The form is one card: the steps in its head, the fields between, the footer at its foot. */
export const STEP_CARD_CLASSES = "fw-panel flex min-w-0 flex-col xl:h-full xl:min-h-0";
export const STEP_HEAD_CLASSES = "border-b border-line px-4 py-3.5 sm:px-5";
export const SPLIT_FIELDS_CLASSES =
  "flex min-w-0 flex-col gap-8 p-4 sm:p-5 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:overscroll-contain";
export const SPLIT_ASIDE_CLASSES = "xl:h-full xl:overflow-y-auto xl:overscroll-contain xl:pr-1";
export const STEP_FOOTER_CLASSES =
  "sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] z-[1] flex flex-col-reverse gap-2 rounded-b-lg border-t border-line bg-surface px-4 py-3 sm:flex-row sm:items-center sm:gap-3 sm:px-5 lg:bottom-0";

/** One group of fields at a time. Every group stays mounted, so moving between steps keeps what was typed. */
export function useFormSteps(steps: readonly StepperStep[]) {
  const [step, setStep] = useState(0);
  const at = steps[step]?.id;
  return {
    steps,
    step,
    setStep,
    at,
    last: step === steps.length - 1,
    /** The class of a step's group: `hidden` keeps it mounted, `contents` lets its panel sit in the form's column. */
    shows: (id: string) => (at === id ? "contents" : "hidden"),
    /** Opens the step that holds the first invalid field, then focuses it. */
    focusError: (form: HTMLFormElement) => {
      const invalid = form.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid]');
      const id = invalid?.closest<HTMLElement>("[data-step]")?.dataset.step;
      const index = steps.findIndex((s) => s.id === id);
      if (index >= 0) flushSync(() => setStep(index));
      invalid?.focus();
    },
  };
}

export type FormSteps = ReturnType<typeof useFormSteps>;

export interface StepFormProps {
  /** Names the steps for screen readers. */
  label: string;
  flow: FormSteps;
  /** Editing a saved record: each step opens from the stepper and Save is on every step. */
  editing: boolean;
  cancelHref: string;
  copy: { back: string; continue: string; cancel: string; save: string };
  busy: boolean;
  /** Checks the step on screen and shows its errors; true moves on. */
  onContinue: (form: HTMLFormElement) => boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onInput?: (event: FormEvent<HTMLFormElement>) => void;
  error: string;
  /** What the record will look like where it is used, beside the form on wide screens. */
  preview?: ReactNode;
  children: ReactNode;
}

/** A form in steps with a live preview beside it, so a short step never leaves the page empty. */
export function StepForm({
  label,
  flow,
  editing,
  cancelHref,
  copy,
  busy,
  onContinue,
  onSubmit,
  onInput,
  error,
  preview,
  children,
}: StepFormProps) {
  const { steps, step, setStep, last } = flow;
  const proceed = (form: HTMLFormElement | null) => {
    if (form && onContinue(form)) setStep(step + 1);
  };
  const continueButton = (
    // Keys keep Continue and Save separate elements: reusing one would turn Continue into a submit mid-click.
    <Button
      key="continue"
      variant={editing ? "secondary" : "primary"}
      onClick={(event) => {
        event.preventDefault();
        proceed(event.currentTarget.form);
      }}
    >
      {copy.continue}
      <ArrowRight aria-hidden className="size-[var(--fw-icon-sm)]" />
    </Button>
  );
  return (
    <div className={SPLIT_CLASSES}>
      <Form onSubmit={onSubmit} onInput={onInput} className={SPLIT_FORM_CLASSES}>
        <div className={STEP_CARD_CLASSES}>
          <div className={STEP_HEAD_CLASSES}>
            <Stepper
              label={label}
              steps={steps}
              current={step}
              onStepClick={setStep}
              free={editing}
            />
          </div>
          <div className={SPLIT_FIELDS_CLASSES}>
            <FlatFieldGroups value>{children}</FlatFieldGroups>
            <p role="alert" className="text-sm text-danger empty:hidden">
              {error}
            </p>
          </div>
          <div className={STEP_FOOTER_CLASSES}>
            {step > 0 && !editing ? (
              <Button variant="secondary" onClick={() => setStep(step - 1)}>
                <ArrowLeft aria-hidden className="size-[var(--fw-icon-sm)]" />
                {copy.back}
              </Button>
            ) : (
              <Link href={cancelHref} className={buttonClasses({ variant: "ghost" })}>
                {copy.cancel}
              </Link>
            )}
            <span className="hidden flex-1 sm:block" />
            {editing && !last ? continueButton : null}
            {editing || last ? (
              <Button key="save" type="submit" loading={busy}>
                {copy.save}
              </Button>
            ) : (
              continueButton
            )}
          </div>
        </div>
      </Form>
      {preview ? <div className={`max-xl:hidden ${SPLIT_ASIDE_CLASSES}`}>{preview}</div> : null}
    </div>
  );
}

export interface FormPreviewProps {
  title: string;
  note: string;
  /** It stands for a PDF, which is white in both themes; pages follow the theme as the real ones do. */
  paper?: boolean;
  children: ReactNode;
}

/** The preview panel beside a step form. */
export function FormPreview({ title, note, paper = false, children }: FormPreviewProps) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users scroll a preview longer than the screen
    <section aria-label={title} tabIndex={0} className="fw-panel">
      <div className="fw-panel-head flex-col items-start gap-0.5">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <p className="text-sm text-muted">{note}</p>
      </div>
      <div className="p-4 sm:p-5">
        <div
          data-theme={paper ? "light" : undefined}
          className="rounded-lg bg-surface-2 p-4 text-ink sm:p-6"
        >
          {children}
        </div>
      </div>
    </section>
  );
}
