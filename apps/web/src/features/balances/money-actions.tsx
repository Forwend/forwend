"use client";

import { ActionButton, Tooltip } from "@forwend/ui-web";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Landmark,
  type LucideIcon,
} from "lucide-react";
import { BALANCES_COPY } from "@/features/balances/balances-copy";

const ACTIONS: readonly { label: string; icon: LucideIcon; soon?: string }[] = [
  { label: BALANCES_COPY.receive, icon: ArrowDownLeft },
  { label: BALANCES_COPY.send, icon: ArrowUpRight, soon: BALANCES_COPY.sendSoon },
  { label: BALANCES_COPY.transfer, icon: ArrowLeftRight, soon: BALANCES_COPY.transferSoon },
  { label: BALANCES_COPY.withdraw, icon: Landmark, soon: BALANCES_COPY.withdrawSoon },
];

// Only Receive works today; the others keep their place, say why in their accessible name and show "Coming soon" on
// hover or focus.
export function MoneyActions({ onReceive }: { onReceive: () => void }) {
  return (
    <fieldset className="m-0 min-w-0 self-center border-0 p-0 lg:self-start">
      <legend className="sr-only">{BALANCES_COPY.actions}</legend>
      <div className="grid grid-cols-4 gap-4 lg:gap-6">
        {ACTIONS.map(({ label, icon, soon }) =>
          soon ? (
            <Tooltip key={label} content={BALANCES_COPY.comingSoon}>
              <ActionButton icon={icon} label={label} disabledReason={soon} />
            </Tooltip>
          ) : (
            <ActionButton key={label} icon={icon} label={label} primary onClick={onReceive} />
          ),
        )}
      </div>
    </fieldset>
  );
}
