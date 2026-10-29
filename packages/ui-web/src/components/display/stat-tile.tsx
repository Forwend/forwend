import type { ReactNode } from "react";

export interface StatTileProps {
  label: string;
  value: ReactNode;
  note?: string;
}

export function StatTile({ label, value, note }: StatTileProps) {
  return (
    <div className="rounded-lg border border-line bg-surface p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-xl text-ink">{value}</p>
      {note ? <p className="mt-1 text-xs text-subtle">{note}</p> : null}
    </div>
  );
}
