import type { LucideIcon } from "lucide-react";

export function StepLead({
  icon: Icon,
  title,
  body,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span className="grid size-14 place-items-center rounded-xl bg-surface-2 text-accent">
        <Icon aria-hidden className="size-7" strokeWidth={1.6} />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold text-ink">{title}</p>
        <p className="text-sm break-words text-muted">{body}</p>
      </div>
    </div>
  );
}
