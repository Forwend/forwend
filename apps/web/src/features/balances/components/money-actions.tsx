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

// Five buttons share a phone's row: below 360 px the labels shrink, so they never touch.
const NARROW = "min-w-0 max-[359px]:text-xs";

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
    <fieldset className="m-0 w-full max-w-sm min-w-0 self-center border-0 p-0 lg:w-auto lg:max-w-none lg:self-start">
      <legend className="sr-only">{BALANCES_COPY.actions}</legend>
      <div className="grid grid-cols-5 gap-1 min-[360px]:gap-2 sm:gap-4 lg:gap-6">
        {actions.map(({ label, icon, soon, onClick }) =>
          soon ? (
            <Tooltip key={label} content={BALANCES_COPY.comingSoon}>
              <ActionButton icon={icon} label={label} disabledReason={soon} className={NARROW} />
            </Tooltip>
          ) : (
            <ActionButton
              key={label}
              icon={icon}
              label={label}
              primary
              onClick={onClick}
              className={NARROW}
            />
          ),
        )}
      </div>
    </fieldset>
  );
}
