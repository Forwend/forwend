"use client";

import {
  Button,
  NetworkWarning,
  QrCode,
  ReceiveAddress,
  SelectField,
  Sheet,
  Skeleton,
} from "@forwend/ui-web";
import { useState } from "react";
import type { Balances } from "@/features/balances/balances";
import { RECEIVE_COPY } from "@/features/receive/receive-copy";
import { chainName, isTestnet } from "@/shared/chains/chains";

// Receive, in a sheet over the dashboard. The address never shows without the warning naming its exact network and
// token, so while the enabled tokens load, or if they fail, it stays hidden.
export function ReceiveSheet({
  open,
  onOpenChange,
  address,
  balances,
  failed,
  onRetry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  address: string | null;
  balances: Balances | null;
  failed: boolean;
  onRetry: () => void;
}) {
  const tokens = balances?.tokens ?? [];
  const [picked, setPicked] = useState("");
  const chosen = tokens.find((t) => `${t.chainId}:${t.token}` === picked) ?? tokens[0];

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={RECEIVE_COPY.receive}>
      {!address ? (
        <p className="text-sm text-muted">{RECEIVE_COPY.noWallet}</p>
      ) : !balances && failed ? (
        <div role="alert" className="flex flex-col items-start gap-3 text-sm text-muted">
          {RECEIVE_COPY.receiveFailed}
          <Button size="sm" variant="secondary" onClick={onRetry}>
            {RECEIVE_COPY.retry}
          </Button>
        </div>
      ) : !balances ? (
        <Skeleton className="h-80" />
      ) : !chosen ? (
        <p className="text-sm text-muted">{RECEIVE_COPY.receiveNoTokens}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {tokens.length > 1 ? (
            <SelectField
              label={RECEIVE_COPY.receiveNetwork}
              value={`${chosen.chainId}:${chosen.token}`}
              onValueChange={setPicked}
              options={tokens.map((t) => ({
                value: `${t.chainId}:${t.token}`,
                label: `${t.symbol} · ${chainName(t.chainId)}`,
              }))}
            />
          ) : null}
          <QrCode value={address} label={RECEIVE_COPY.receiveQrLabel} className="mx-auto w-44" />
          <ReceiveAddress address={address} />
          <NetworkWarning token={chosen.symbol} network={chainName(chosen.chainId)} />
          <p className="text-sm text-muted">
            {isTestnet(chosen.chainId)
              ? `${chainName(chosen.chainId)} ${RECEIVE_COPY.testnetNote} `
              : null}
            {RECEIVE_COPY.receiveNote}
          </p>
        </div>
      )}
    </Sheet>
  );
}
