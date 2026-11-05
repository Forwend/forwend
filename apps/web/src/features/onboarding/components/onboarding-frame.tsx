"use client";

import { Button } from "@forwend/ui-web";
import { type FormEvent, type ReactNode, useEffect, useRef } from "react";
import { SIGN_IN_COPY } from "@/features/auth/constants/sign-in";
import { FIRST_RUN_COPY as COPY } from "@/features/onboarding/constants/onboarding-copy";
import { SiteBar, SiteBarRow, SiteBrand } from "@/shared/components/site-bar/site-bar";

export interface OnboardingFrameProps {
  /** 0-based. */
  step: number;
  steps: number;
  title: string;
  intro: ReactNode;
  onSignOut: () => void;
  onSubmit: () => void;
  /** The footer's left end: Back, or Skip on the first step. */
  secondary?: ReactNode;
  /** The footer's main action. */
  primary: ReactNode;
  /** Beside the main action: leaves the step without its answers. */
  skip?: ReactNode;
  /** Above the question, such as the step's icon. */
  lead?: ReactNode;
  /** Centers the mark, question and content, for a step with no fields. */
  centered?: boolean;
  error: string;
  /** Beside the form from large screens, such as the invoice the details make. */
  aside?: ReactNode;
  children: ReactNode;
}

const COLUMN = "mx-auto w-[min(calc(100%-var(--fw-page-gutter)*2),var(--fw-page-width))]";

/** One first-run step (R-50): the logo where landing and sign-in put it, the step count and progress, the question,
 * then Back on the left and the main action on the right; phones stack the two at the foot, the main action first. */
export function OnboardingFrame({
  step,
  steps,
  title,
  intro,
  onSignOut,
  onSubmit,
  secondary,
  primary,
  skip,
  lead,
  centered,
  error,
  aside,
  children,
}: OnboardingFrameProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  // A new step is a new question: screen readers and the keyboard start from its heading.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the step changes
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <SiteBar plain>
        <SiteBarRow>
          <SiteBrand label={SIGN_IN_COPY.homeLabel} />
          <div className="col-start-3 flex items-center gap-2 justify-self-end sm:gap-4">
            <span className="text-sm text-muted tabular-nums">
              {COPY.stepCount(step + 1, steps)}
            </span>
            <Button variant="ghost" size="sm" onClick={onSignOut}>
              {COPY.signOut}
            </Button>
          </div>
        </SiteBarRow>
      </SiteBar>
      <div
        aria-hidden
        className={`${COLUMN} mt-2 grid gap-1.5`}
        style={{ gridTemplateColumns: `repeat(${steps}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: steps }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positions
          <span key={i} className="h-1 overflow-hidden rounded-pill bg-line">
            <span
              className={`block h-full origin-left bg-ink transition-transform duration-[var(--fw-duration-slow)] ease-[var(--fw-ease-out)] ${i <= step ? "scale-x-100" : "scale-x-0"}`}
            />
          </span>
        ))}
      </div>
      <main
        className={`${COLUMN} grid flex-1 items-start justify-center gap-x-24 pt-7 sm:content-center sm:py-[clamp(1.5rem,6vh,4rem)] ${centered ? "max-sm:items-stretch" : ""} ${aside ? "lg:grid-cols-[minmax(0,35rem)_minmax(0,27rem)]" : "grid-cols-[minmax(0,40rem)]"}`}
      >
        <form
          noValidate
          onSubmit={submit}
          className="flex min-h-full min-w-0 flex-col gap-6 sm:gap-7"
        >
          {/* Each step rises in once; the footer stays put. */}
          <div
            key={step}
            // A centered step on a phone sits in the middle of the space above the footer.
            className={`flex flex-col gap-6 animate-[fw-pop-in_var(--fw-duration-slow)_var(--fw-ease-out)] sm:gap-7 ${centered ? "max-sm:flex-1 max-sm:justify-center" : ""}`}
          >
            {lead ? <div className={centered ? "self-center" : undefined}>{lead}</div> : null}
            <div
              className={`flex flex-col gap-2 sm:gap-2.5 ${centered ? "items-center text-center" : ""}`}
            >
              <h1
                ref={heading}
                tabIndex={-1}
                className="text-[1.75rem] leading-[1.15] font-medium tracking-tight text-balance text-ink outline-none sm:text-3xl"
              >
                {title}
              </h1>
              <p
                className={`text-base text-muted sm:text-lg ${centered ? "text-balance" : "text-pretty"}`}
              >
                {intro}
              </p>
            </div>
            {children}
          </div>
          <p role="alert" className="text-sm text-danger empty:hidden">
            {error}
          </p>
          {/* Phones: the main action across the foot, Back and Skip in one row under it. */}
          <div className="sticky bottom-0 -mx-[var(--fw-page-gutter)] mt-auto grid grid-cols-2 items-center gap-x-3 gap-y-3 border-t border-line bg-bg px-[var(--fw-page-gutter)] pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:mt-0 sm:flex sm:justify-between sm:px-0 sm:pt-4 sm:pb-0">
            <div
              className={`order-2 sm:order-none ${skip ? "max-sm:[&>*]:w-full" : "col-span-2 justify-self-center"}`}
            >
              {secondary}
            </div>
            <div className="contents sm:flex sm:items-center sm:gap-2">
              {skip ? (
                <div className="order-3 sm:order-none max-sm:[&>*]:w-full">{skip}</div>
              ) : null}
              <div className="order-1 col-span-2 sm:order-none max-sm:[&>*]:w-full">{primary}</div>
            </div>
          </div>
        </form>
        {aside ? (
          <aside
            key={step}
            className="hidden min-w-0 animate-[fw-fade-in_var(--fw-duration-slow)_var(--fw-ease-out)] lg:block"
          >
            {aside}
          </aside>
        ) : null}
      </main>
    </div>
  );
}
