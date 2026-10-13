import { ChevronDown } from "lucide-react";

export function ProfilePill({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={onClick}
      className="relative inline-flex h-8 items-center gap-1 rounded-pill bg-surface px-3 text-xs font-medium text-ink shadow-sm outline-none ring-1 ring-line focus-visible:outline-2 focus-visible:outline-focus after:absolute after:-inset-1.5 lg:hidden"
    >
      {name}
      <ChevronDown aria-hidden className="size-[var(--fw-icon-sm)]" />
    </button>
  );
}
