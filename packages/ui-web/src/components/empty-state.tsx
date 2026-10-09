import { Inbox } from "lucide-react";
import type { EmptyStateProps } from "../types/ui/display";

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
      <Inbox aria-hidden className="size-[var(--fw-icon-lg)] text-subtle" />
      <p className="mt-4 text-lg font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-sm text-muted">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
