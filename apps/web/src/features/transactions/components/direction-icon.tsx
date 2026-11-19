import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { TRANSACTION_DIRECTIONS } from "@/features/transactions/constants/transactions";
import type { Transaction } from "@/features/transactions/types/transactions";
import { ChainBadge } from "@/shared/components/chains/chain-badge";

export interface DirectionIconProps {
  t: Transaction;
  badgeClassName?: string;
  large?: boolean;
}

/** The round icon that leads a row: the direction, with the network's logo on its corner. */
export function DirectionIcon({ t, badgeClassName = "", large = false }: DirectionIconProps) {
  const incoming = t.direction === TRANSACTION_DIRECTIONS.in;
  const Icon = incoming ? ArrowDownLeft : ArrowUpRight;
  return (
    <span
      className={`relative grid shrink-0 place-items-center rounded-pill ${large ? "size-9" : "size-7"} ${incoming ? "bg-success-soft text-success" : "bg-surface-2 text-muted"}`}
    >
      <Icon aria-hidden className="size-[var(--fw-icon-sm)]" />
      <ChainBadge chainId={t.chainId} className={badgeClassName} />
    </span>
  );
}
