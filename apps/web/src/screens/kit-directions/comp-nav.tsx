import { CTA } from "@/features/waitlist/waitlist";
import { NAV_VARIANTS, type NavVariant } from "@/screens/kit-directions/comp";

interface CompNavProps {
  variant: NavVariant;
}

const LINKS = ["Product", "Developers", "FAQ"] as const;

export function CompNav({ variant }: CompNavProps) {
  const shell =
    variant === NAV_VARIANTS.pill
      ? "mx-auto w-fit gap-6 rounded-full border border-[var(--line)] bg-[var(--surface)] py-1.5 pr-1.5 pl-5 backdrop-blur-md"
      : "w-full justify-between gap-6 px-1";
  return (
    <nav aria-label="Sample navigation" className={`flex items-center text-sm ${shell}`}>
      <span className="font-semibold tracking-tight">Forwend</span>
      <span className="hidden items-center gap-5 text-[var(--muted)] sm:flex">
        {LINKS.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </span>
      <span className="rounded-full bg-[var(--ink)] px-4 py-2 font-medium text-[var(--onInk)]">
        {CTA.joinWaitlist}
      </span>
    </nav>
  );
}
