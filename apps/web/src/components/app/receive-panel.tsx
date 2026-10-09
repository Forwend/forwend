"use client";

import {
  Button,
  NetworkWarning,
  QrCode,
  ReceiveAddress,
  SelectField,
  Skeleton,
} from "@forwend/ui-web";
import { useState } from "react";
import { PROFILE_PAGE_COPY as COPY } from "@/constants/profile-page";
import { chainName, isTestnet } from "@/lib/chain";
import type { Balances } from "@/types/app/money";

// The address never shows without the warning that names its exact network and token, so while the enabled tokens
// load, or if they fail, it stays hidden.
export function ReceivePanel({
  address,
  balances,
  failed,
  onRetry,
}: {
  address: string | null;
  balances: Balances | null;
  failed: boolean;
  onRetry: () => void;
}) {
  const tokens = balances?.tokens ?? [];
  const [picked, setPicked] = useState("");
  const chosen = tokens.find((t) => `${t.chainId}:${t.token}` === picked) ?? tokens[0];

  return (
    <section aria-labelledby="receive-title" className="flex flex-col gap-4">
      <h2 id="receive-title" className="text-lg font-medium text-ink">
        {COPY.receive}
      </h2>
      {!address ? (
        <p className="text-sm text-muted">{COPY.noWallet}</p>
      ) : !balances && failed ? (
        <div role="alert" className="flex flex-col items-start gap-3 text-sm text-muted">
          {COPY.receiveFailed}
          <Button size="sm" variant="secondary" onClick={onRetry}>
            {COPY.retry}
          </Button>
        </div>
      ) : !balances ? (
        <Skeleton className="h-80" />
      ) : !chosen ? (
        <p className="text-sm text-muted">{COPY.receiveNoTokens}</p>
      ) : (
        <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5 shadow-sm">
          <QrCode value={address} label={COPY.receiveQrLabel} className="mx-auto w-40" />
          <ReceiveAddress address={address} />
          {tokens.length > 1 ? (
            <SelectField
              label={COPY.receiveNetwork}
              value={`${chosen.chainId}:${chosen.token}`}
              onValueChange={setPicked}
              options={tokens.map((t) => ({
                value: `${t.chainId}:${t.token}`,
                label: `${t.symbol} · ${chainName(t.chainId)}`,
              }))}
            />
          ) : null}
          <NetworkWarning token={chosen.symbol} network={chainName(chosen.chainId)} />
          <p className="text-sm text-muted">
            {isTestnet(chosen.chainId) ? `${chainName(chosen.chainId)} ${COPY.testnetNote} ` : null}
            {COPY.receiveNote}
          </p>
        </div>
      )}
    </section>
  );
}
