import { SuccessCheck } from "@forwend/ui-web";
import { ArrowRight, BookOpen, Droplet } from "lucide-react";
import type { ComponentType } from "react";
import { TEST_USDC_FAUCET } from "@/features/onboarding/constants/onboarding";
import { FIRST_RUN_COPY } from "@/features/onboarding/constants/onboarding-copy";
import type { ProfileKind } from "@/features/profiles/types/profile";
import { docsPath } from "@/shared/config/docs-routes";

const COPY = FIRST_RUN_COPY.ready;

export interface ReadyAction {
  /** The profile the action opens in. */
  kind: ProfileKind;
  href: string;
  title: string;
  hint: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

export interface ReadyStepProps {
  /** One per goal picked, the first as the main one. */
  actions: readonly ReadyAction[];
  onAction: (action: ReadyAction) => void;
  /** Developer mode (D-120): the faucet's test USDC is the money to try it with. */
  testnet: boolean;
}

const CARD =
  "group flex items-center gap-3 rounded-lg border bg-surface p-4 text-left sm:gap-4 sm:p-5 text-ink transition-colors duration-[var(--fw-duration-fast)] hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

// The same box as the main action's icon, so every card's text starts at one line.
const TILE =
  "grid size-10 shrink-0 place-items-center rounded-md bg-surface-2 text-accent sm:size-11";

export function ReadyLead() {
  return (
    <span className="grid size-16 place-items-center rounded-pill bg-success-soft sm:size-24">
      <SuccessCheck label={COPY.done} className="size-10 sm:size-14" />
    </span>
  );
}

/** The first thing to do with each profile, the main one first, then test money and the docs' first payment. */
export function ReadyStep({ actions, onAction, testnet }: ReadyStepProps) {
  const [main, ...more] = actions;
  return (
    <div className="flex flex-col gap-3">
      {main ? (
        <button type="button" onClick={() => onAction(main)} className={`${CARD} border-ink`}>
          <span className="grid size-10 shrink-0 place-items-center rounded-md border border-brand-edge bg-brand text-on-brand sm:size-11">
            <main.icon aria-hidden className="size-5" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-base leading-snug font-medium sm:text-lg">{main.title}</span>
            <span className="text-sm text-muted">{main.hint}</span>
          </span>
          <ArrowRight
            aria-hidden
            className="size-5 shrink-0 transition-transform duration-[var(--fw-duration-fast)] group-hover:translate-x-0.5 max-sm:hidden"
          />
        </button>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {more.map((action) => (
          <button
            key={action.href}
            type="button"
            onClick={() => onAction(action)}
            className={`${CARD} border-line`}
          >
            <span className={TILE}>
              <action.icon aria-hidden className="size-5" />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium">{action.title}</span>
              <span className="text-sm text-muted">{action.hint}</span>
            </span>
          </button>
        ))}
        {testnet ? (
          <a
            href={TEST_USDC_FAUCET}
            target="_blank"
            rel="noreferrer"
            className={`${CARD} border-line`}
          >
            <span className={TILE}>
              <Droplet aria-hidden className="size-5" />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium">{COPY.faucet}</span>
              <span className="text-sm text-muted">{COPY.faucetHint}</span>
            </span>
            <span className="sr-only">{COPY.newTab}</span>
          </a>
        ) : null}
        <a href={docsPath("start/first-test-payment")} className={`${CARD} border-line`}>
          <span className={TILE}>
            <BookOpen aria-hidden className="size-5" />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium">{COPY.guide}</span>
            <span className="text-sm text-muted">{COPY.guideHint}</span>
          </span>
        </a>
      </div>
    </div>
  );
}
