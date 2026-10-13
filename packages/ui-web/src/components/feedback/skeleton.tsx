import { cx } from "../../lib/cx";

export interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <span aria-hidden className={cx("block animate-pulse rounded-md bg-surface-2", className)} />
  );
}
