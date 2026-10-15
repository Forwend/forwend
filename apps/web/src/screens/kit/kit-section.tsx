import type { ReactNode } from "react";
import type { KitSectionTitle } from "@/screens/kit/types/kit-content";

interface KitSectionProps {
  title: KitSectionTitle;
  note?: string;
  children: ReactNode;
}

interface KitGroupProps {
  title: string;
  children: ReactNode;
}

export function KitSection({ title, note, children }: KitSectionProps) {
  const id = title.toLowerCase().replace(/\s+/g, "-");
  return (
    <section aria-labelledby={id} className="border-t border-line py-14 first-of-type:border-t-0">
      <h2 id={id} className="font-display text-3xl">
        {title}
      </h2>
      {note ? <p className="mt-2 max-w-2xl text-muted">{note}</p> : null}
      <div className="mt-8">{children}</div>
    </section>
  );
}

export function KitGroup({ title, children }: KitGroupProps) {
  return (
    <div className="border-t border-line pt-6 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold text-muted">{title}</h3>
      <div className="mt-4 flex flex-wrap items-start gap-4 [&>*]:min-w-0 [&>*]:max-w-full">
        {children}
      </div>
    </div>
  );
}
