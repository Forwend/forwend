import { type ReactNode, useId } from "react";

export interface SplitSectionProps {
  title: string;
  description: string;
  children: ReactNode;
}

/** A settings section: what it is and why on the left, its panel on the right; stacked on narrow screens. */
export function SplitSection({ title, description, children }: SplitSectionProps) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="grid gap-x-8 gap-y-3 border-t border-line pt-6 first:border-t-0 first:pt-0 lg:grid-cols-[14rem_minmax(0,1fr)]"
    >
      <div>
        <h2 id={id} className="text-base font-semibold text-ink">
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
