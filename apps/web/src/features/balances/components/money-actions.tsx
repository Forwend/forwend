"use client";

import { ActionButton, Tooltip } from "@forwend/ui-web";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  HandCoins,
  Landmark,
  type LucideIcon,
} from "lucide-react";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";

export interface MoneyActionsProps {
  onReceive: () => void;
  onRequest: () => void;
}

// Receive and Request work; the others keep their place, say why in their accessible name and show "Coming soon" on
// hover or focus. Five fit a phone's row with the narrow gap.
export function MoneyActions({ onReceive, onRequest }: MoneyActionsProps) {
  const actions: readonly {
    label: string;
    icon: LucideIcon;
    soon?: string;
    onClick?: () => void;
  }[] = [
    { label: BALANCES_COPY.receive, icon: ArrowDownLeft, onClick: onReceive },
    { label: BALANCES_COPY.request, icon: HandCoins, onClick: onRequest },
    { label: BALANCES_COPY.send, icon: ArrowUpRight, soon: BALANCES_COPY.sendSoon },
    { label: BALANCES_COPY.transfer, icon: ArrowLeftRight, soon: BALANCES_COPY.transferSoon },
    { label: BALANCES_COPY.withdraw, icon: Landmark, soon: BALANCES_COPY.withdrawSoon },
  ];
  return (
    <fieldset className="m-0 w-full min-w-0 max-w-sm self-center border-0 p-0 sm:w-auto sm:max-w-none lg:self-start">
      <legend className="sr-only">{BALANCES_COPY.actions}</legend>
      <div className="grid grid-cols-5 gap-1 sm:gap-4 lg:gap-6">
        {actions.map(({ label, icon, soon, onClick }) =>
          soon ? (
            <Tooltip key={label} content={BALANCES_COPY.comingSoon}>
              <ActionButton icon={icon} label={label} disabledReason={soon} />
            </Tooltip>
          ) : (
            <ActionButton key={label} icon={icon} label={label} primary onClick={onClick} />
          ),
        )}
      </div>
    </fieldset>
  );
}
