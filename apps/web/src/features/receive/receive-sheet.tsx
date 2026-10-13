"use client";

import {
  Badge,
  BrandIcon,
  Button,
  NetworkWarning,
  QrCode,
  ReceiveAddress,
  Sheet,
  Skeleton,
  TONES,
} from "@forwend/ui-web";
import { ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Balances } from "@/features/balances/balances";
import { addressFor, CHAIN_FAMILIES, receiveChoice } from "@/features/receive/receive-choice";
import { RECEIVE_COPY } from "@/features/receive/receive-copy";
import { CHAINS, chainName, isTestnet, TOKEN_ICONS } from "@/shared/chains/chains";
import { TokenMark } from "@/shared/chains/token-mark";

// Receive, in a sheet over the dashboard. The user picks the token, then the network; the address never shows without
// the warning naming that exact network and token, so while the enabled tokens load, or if they fail, it stays hidden.
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
  const [symbol, setSymbol] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  // Every opening starts from the token, so the address shows only for a choice made this time.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSymbol(null);
      setNetwork(null);
    }
  }
  // The API lists EVM chains only today.
  const options = (balances?.tokens ?? []).map((t) => ({
    symbol: t.symbol,
    network: String(t.chainId),
    family: CHAIN_FAMILIES.evm,
    chainId: t.chainId,
  }));
  const choice = receiveChoice(options, symbol, network);
  const chosen = choice.option;
  const shown = chosen && address ? addressFor(chosen, { [CHAIN_FAMILIES.evm]: address }) : null;

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
        <Skeleton className="h-128" />
      ) : options.length === 0 ? (
        <p className="text-sm text-muted">{RECEIVE_COPY.receiveNoTokens}</p>
      ) : !choice.symbol ? (
        <Choices title={RECEIVE_COPY.token}>
          {choice.symbols.map((s) => (
            <Choice
              key={s}
              icon={<TokenIcon symbol={s} />}
              label={s}
              note={RECEIVE_COPY.networks(options.filter((o) => o.symbol === s).length)}
              onClick={() => setSymbol(s)}
            />
          ))}
        </Choices>
      ) : !chosen ? (
        <div className="flex flex-col gap-4">
          {choice.symbols.length > 1 ? (
            <Summary onChange={() => setSymbol(null)}>
              <TokenIcon symbol={choice.symbol} />
              <span className="text-sm font-medium text-ink">{choice.symbol}</span>
            </Summary>
          ) : null}
          <Choices title={RECEIVE_COPY.network}>
            {choice.networks.map((o) => {
              const icon = CHAINS[o.chainId]?.icon;
              return (
                <Choice
                  key={o.network}
                  icon={
                    icon ? (
                      <BrandIcon name={icon} className="size-8 rounded-md" />
                    ) : (
                      <Initial text={chainName(o.chainId)} />
                    )
                  }
                  label={chainName(o.chainId)}
                  note={isTestnet(o.chainId) ? RECEIVE_COPY.testnet : null}
                  onClick={() => setNetwork(o.network)}
                />
              );
            })}
          </Choices>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Summary
            onChange={
              options.length > 1
                ? () => {
                    setSymbol(null);
                    setNetwork(null);
                  }
                : null
            }
          >
            <TokenMark chainId={chosen.chainId} symbol={chosen.symbol} />
            {isTestnet(chosen.chainId) ? (
              <Badge tone={TONES.info}>{RECEIVE_COPY.testnet}</Badge>
            ) : null}
          </Summary>
          <NetworkWarning token={chosen.symbol} network={chainName(chosen.chainId)} />
          {shown ? (
            <>
              <div className="grid place-items-center rounded-lg bg-surface-2 p-5">
                <QrCode
                  value={shown}
                  label={RECEIVE_COPY.receiveQrLabel}
                  className="w-52 p-2 shadow-sm"
                />
              </div>
              <ReceiveAddress
                address={shown}
                label={RECEIVE_COPY.yourAddress(chainName(chosen.chainId))}
              />
            </>
          ) : null}
          <p className="text-xs text-muted">
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

function Choices({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-muted">{title}</h3>
      <ul className="flex flex-col gap-1">{children}</ul>
    </section>
  );
}

function Choice({
  icon,
  label,
  note,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  note: string | null;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex min-h-14 w-full items-center gap-3 rounded-md px-2 text-left text-ink outline-none hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus"
      >
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
        {note ? <span className="text-xs text-muted">{note}</span> : null}
        <ChevronRight aria-hidden className="size-[var(--fw-icon-sm)] text-muted" />
      </button>
    </li>
  );
}

function TokenIcon({ symbol }: { symbol: string }) {
  const icon = TOKEN_ICONS[symbol];
  return icon ? <BrandIcon name={icon} className="size-8" /> : <Initial text={symbol} />;
}

function Initial({ text }: { text: string }) {
  return (
    <span className="grid size-8 place-items-center rounded-pill bg-surface-2 text-xs text-muted">
      {text.slice(0, 1)}
    </span>
  );
}

// The choice so far, folded into one row; Change opens the choice again.
function Summary({ onChange, children }: { onChange: (() => void) | null; children: ReactNode }) {
  return (
    <div className="flex min-h-14 items-center gap-3 rounded-md border border-line px-3 py-2">
      <span className="flex min-w-0 flex-1 items-center gap-3">{children}</span>
      {onChange ? (
        <Button size="sm" variant="ghost" aria-label={RECEIVE_COPY.changeLabel} onClick={onChange}>
          {RECEIVE_COPY.change}
        </Button>
      ) : null}
    </div>
  );
}
