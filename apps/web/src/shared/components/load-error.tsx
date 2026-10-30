import { Button, Notice } from "@forwend/ui-web";
import { AlertCircle } from "lucide-react";
import { useServerUnreachable } from "@/shared/api/server-reach";

const RETRY = "Try again";

export interface LoadErrorProps {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
  /** The last data still shows below: a one-line notice, not a state in its place. */
  inline?: boolean;
  /** The page's only content: centered in the workspace, as a page's empty state is. */
  page?: boolean;
}

/** A read that failed, in the place of what it would show: centered like an empty state, with one way to try again. */
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
    // It fills what it stands in for, so a card keeps its size and the state sits in its middle.
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
