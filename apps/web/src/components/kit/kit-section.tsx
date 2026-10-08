import type { ReactNode } from "react";

export function KitSection({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  const id = title.toLowerCase().replace(/\s+/g, "-");
  return (
    <section aria-labelledby={id} className="border-t border-line py-12 first-of-type:border-t-0">
      <h2 id={id} className="font-display text-3xl tracking-[-0.01em]">
        {title}
      </h2>
      {note ? <p className="mt-2 max-w-2xl text-muted">{note}</p> : null}
      <div className="mt-8">{children}</div>
    </section>
  );
}
