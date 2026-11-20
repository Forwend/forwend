"use client";

import { Button, buttonClasses, Form, Stepper } from "@forwend/ui-web";
import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import type { FormEvent, ReactNode } from "react";
import { FlatFieldGroups } from "@/shared/components/field-group";
import type { useFormSteps } from "@/shared/hooks/use-form-steps";

// From xl the form and preview each scroll on their own, so the footer's buttons stay in view.
const SPLIT_CLASSES =
  "grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:h-[calc(100dvh-11.5rem)] xl:min-h-[32rem] xl:grid-cols-[minmax(0,40rem)_minmax(0,1fr)] xl:items-stretch xl:gap-10";
export const SPLIT_FORM_CLASSES = "min-h-0 xl:h-full";
const STEP_CARD_CLASSES = "fw-panel flex min-w-0 flex-col xl:h-full xl:min-h-0";
export const STEP_HEAD_CLASSES = "border-b border-line px-4 py-3.5 sm:px-5";
export const SPLIT_FIELDS_CLASSES =
  "flex min-w-0 flex-col gap-8 p-4 sm:p-5 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:overscroll-contain";
const SPLIT_ASIDE_CLASSES = "xl:h-full xl:overflow-y-auto xl:overscroll-contain xl:pr-1";
const STEP_FOOTER_CLASSES =
  "sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] z-[1] flex flex-col-reverse gap-2 rounded-b-lg border-t border-line bg-surface px-4 py-3 sm:flex-row sm:items-center sm:gap-3 sm:px-5 lg:bottom-0";

export interface StepFormProps {
  label: string;
  flow: ReturnType<typeof useFormSteps>;
  editing: boolean;
  cancelHref: string;
  copy: { back: string; continue: string; cancel: string; save: string };
  busy: boolean;
  onContinue: (form: HTMLFormElement) => boolean; // true moves on
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onInput?: (event: FormEvent<HTMLFormElement>) => void;
  error: string;
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
  paper?: boolean; // a PDF: white in both themes
  children: ReactNode;
}

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
