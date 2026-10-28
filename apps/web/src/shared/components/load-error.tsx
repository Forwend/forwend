import { Button } from "@forwend/ui-web";
import { AlertCircle } from "lucide-react";

const RETRY = "Try again";

export interface LoadErrorProps {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
}

/** A read that failed, in the place of what it would show, with one way to try again. */
export function LoadError({ message, onRetry, retrying }: LoadErrorProps) {
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
