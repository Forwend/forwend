import { AlertTriangle, Ban, Clock, Wallet } from "lucide-react";
import { cx } from "../../../lib/cx";
import { WALLET_STATES, type WalletState } from "./payment-status";

export interface WalletStateLabelProps {
  state: WalletState;
}

const ICONS: Record<Exclude<WalletState, "none">, typeof Wallet> = {
  pending: Clock,
  inWallet: Wallet,
  delayed: AlertTriangle,
  refused: Ban,
};

const TEXT: Record<Exclude<WalletState, "none">, string> = {
  pending: "text-muted",
  inWallet: "text-success",
  delayed: "text-warning",
  refused: "text-danger",
};

/** Quiet text beside the payment status, so a row never shows two pills. */
export function WalletStateLabel({ state }: WalletStateLabelProps) {
  // Nothing to move yet: a quiet dash in a row, still named for screen readers.
  if (state === "none") {
    return (
      <span data-wallet={state} className="text-sm text-subtle">
        <span aria-hidden>—</span>
        <span className="sr-only">{WALLET_STATES.none.label}</span>
      </span>
    );
  }
  const Icon = ICONS[state];
  return (
    <span
      data-wallet={state}
      className={cx("inline-flex items-center gap-1.5 whitespace-nowrap text-sm", TEXT[state])}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {WALLET_STATES[state].label}
    </span>
  );
}
