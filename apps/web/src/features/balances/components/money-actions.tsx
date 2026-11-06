"use client";

import { ActionButton, Tooltip } from "@forwend/ui-web";
import { ArrowLeftRight, HandCoins, Landmark, type LucideIcon, QrCode, Send } from "lucide-react";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";

export interface MoneyActionsProps {
  onReceive: () => void;
  onRequest: () => void;
  /** Null where the user can't move this profile's money. */
  onSend: (() => void) | null;
  onTransfer: (() => void) | null;
}

// Five buttons share a phone's row: below 360 px the labels shrink, so they never touch.
const NARROW = "min-w-0 max-[359px]:text-xs sm:w-20";

export function MoneyActions({ onReceive, onRequest, onSend, onTransfer }: MoneyActionsProps) {
  const actions: readonly {
    label: string;
    icon: LucideIcon;
    soon?: string;
    primary?: boolean;
    onClick?: () => void;
  }[] = [
    // One lime action per view: Receive, the app's standing one.
    { label: BALANCES_COPY.receive, icon: QrCode, onClick: onReceive, primary: true },
    { label: BALANCES_COPY.request, icon: HandCoins, onClick: onRequest },
    ...(onSend ? [{ label: BALANCES_COPY.send, icon: Send, onClick: onSend }] : []),
    ...(onTransfer
      ? [{ label: BALANCES_COPY.transfer, icon: ArrowLeftRight, onClick: onTransfer }]
      : []),
    { label: BALANCES_COPY.withdraw, icon: Landmark, soon: BALANCES_COPY.withdrawSoon },
  ];
  return (
    <fieldset className="m-0 mx-auto w-full max-w-sm min-w-0 border-0 p-0 sm:mx-0 sm:w-auto sm:max-w-none">
      <legend className="sr-only">{BALANCES_COPY.actions}</legend>
      <div className="grid grid-cols-5 gap-1 min-[360px]:gap-2 sm:flex sm:gap-2">
        {actions.map(({ label, icon, soon, primary, onClick }) =>
          soon ? (
            <Tooltip key={label} content={BALANCES_COPY.comingSoon}>
              <ActionButton icon={icon} label={label} disabledReason={soon} className={NARROW} />
            </Tooltip>
          ) : (
            <ActionButton
              key={label}
              icon={icon}
              label={label}
              primary={primary}
              onClick={onClick}
              className={NARROW}
            />
          ),
        )}
      </div>
    </fieldset>
  );
}
