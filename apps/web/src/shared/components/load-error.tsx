import { Button } from "@forwend/ui-web";
import { AlertCircle } from "lucide-react";

const RETRY = "Try again";

export interface LoadErrorProps {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
  /** The last data still shows below: a one-line notice, not a state in its place. */
  inline?: boolean;
}

/** A read that failed, in the place of what it would show: centered like an empty state, with one way to try again. */
export function LoadError({ message, onRetry, retrying, inline }: LoadErrorProps) {
  if (inline) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface px-4 py-3 text-sm text-muted"
      >
        <AlertCircle aria-hidden className="size-[var(--fw-icon-sm)] shrink-0 text-danger" />
        <span className="min-w-0 flex-1">{message}</span>
        <Button size="sm" variant="secondary" loading={retrying} onClick={onRetry}>
          {RETRY}
        </Button>
      </div>
    );
  }
  return (
    // It fills what it stands in for, so a card keeps its size and the state sits in its middle.
    <div
      role="alert"
      className="flex min-h-40 w-full flex-1 flex-col items-center justify-center px-6 py-8 text-center"
    >
      <span className="grid size-10 place-items-center rounded-md bg-danger-soft">
        <AlertCircle aria-hidden className="size-[var(--fw-icon-lg)] text-danger" />
      </span>
      <p className="mt-3 max-w-xs text-sm font-medium text-ink">{message}</p>
      <Button size="sm" variant="secondary" loading={retrying} onClick={onRetry} className="mt-4">
        {RETRY}
      </Button>
    </div>
  );
}
