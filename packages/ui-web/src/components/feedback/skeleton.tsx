import { cx } from "../../lib/cx";

export function Skeleton({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cx("block animate-pulse rounded-md bg-surface-2", className)} />
  );
}
