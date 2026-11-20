import { Button, Notice } from "@forwend/ui-web";
import { AlertCircle } from "lucide-react";
import { useServerUnreachable } from "@/shared/api/server-reach";

const RETRY = "Try again";

export interface LoadErrorProps {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
  inline?: boolean;
  page?: boolean;
}

/** A failed read in place of what it would show, with one way to try again. */
export function LoadError({ message, onRetry, retrying, inline, page }: LoadErrorProps) {
  // The app shell's one strip says the server can't be reached, so a refresh notice beside it would repeat it.
  const down = useServerUnreachable();
  if (inline && down) return null;
  if (inline) {
    return (
      <Notice
        role="alert"
        action={
          <Button size="sm" variant="secondary" loading={retrying} onClick={onRetry}>
            {RETRY}
          </Button>
        }
      >
        {message}
      </Notice>
    );
  }
  return (
    <div
      role="alert"
      data-page-empty={page ? "" : undefined}
      className={`flex w-full flex-1 flex-col items-center justify-center px-6 py-8 text-center ${page ? "min-h-64" : "min-h-40"}`}
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
