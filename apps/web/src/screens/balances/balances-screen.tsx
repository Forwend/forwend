"use client";

import { ActionButton } from "@forwend/ui-web";
import { QrCode, Send } from "lucide-react";
import { BalanceFigure } from "@/features/balances/components/balance-figure";
import { BalancesList } from "@/features/balances/components/balances-list";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { usePricedBalances } from "@/features/balances/hooks/use-priced-balances";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { PageTitle } from "@/shared/components/page-title";

export function BalancesScreen() {
  const { profile, openReceive, openSend } = useAppSession();
  const { balances, prices, failed, retry } = usePricedBalances(profile.profileId);
  const total = balances ? balances.tokens.length > 0 : !failed;
  return (
    <div className="flex flex-col gap-6">
      <PageTitle>{BALANCES_COPY.balancesTitle}</PageTitle>
      {total ? (
        <div className="@container flex w-full flex-col items-center gap-2 sm:max-w-xs sm:items-start">
          <span className="text-sm text-muted">{BALANCES_COPY.totalBalance}</span>
          <BalanceFigure
            balances={balances}
            prices={prices}
            failed={failed}
            onRetry={retry}
            pending={false}
          />
        </div>
      ) : null}
      <fieldset className="m-0 min-w-0 border-0 p-0 lg:hidden">
        <legend className="sr-only">{BALANCES_COPY.actions}</legend>
        <div className="flex justify-center gap-6 sm:justify-start">
          <ActionButton icon={QrCode} label={BALANCES_COPY.receive} primary onClick={openReceive} />
          {openSend ? (
            <ActionButton icon={Send} label={BALANCES_COPY.send} onClick={openSend} />
          ) : null}
        </div>
      </fieldset>
      <BalancesList balances={balances} prices={prices} failed={failed} onRetry={retry} />
    </div>
  );
}
