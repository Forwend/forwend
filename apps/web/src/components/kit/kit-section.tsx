import type { ReactNode } from "react";
import type { KitSectionTitle } from "@/types/kit/content";

export function KitSection({
  title,
  note,
  children,
}: {
  title: KitSectionTitle;
  note?: string;
  children: ReactNode;
}) {
  const id = title.toLowerCase().replace(/\s+/g, "-");
  return (
    <section
      aria-labelledby={id}
      className="scroll-mt-24 border-t border-line py-14 first-of-type:border-t-0"
    >
      <h2 id={id} className="font-display text-3xl">
        {title}
      </h2>
      {note ? <p className="mt-2 max-w-2xl text-muted">{note}</p> : null}
      <div className="mt-8">{children}</div>
    </section>
  );
}

export function KitGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-line pt-6 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold text-muted">{title}</h3>
      <div className="mt-4 flex flex-wrap items-start gap-4">{children}</div>
    </div>
  );
}
