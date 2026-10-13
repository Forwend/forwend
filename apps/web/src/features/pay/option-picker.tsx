"use client";

import { BrandIcon } from "@forwend/ui-web";
import { useState } from "react";
import type { InvoiceOption } from "@/features/invoices/invoices";
import { PAY_COPY as COPY } from "@/features/pay/pay-copy";
import { CHAINS, chainName, TOKEN_ICONS } from "@/shared/chains/chains";

export interface Choice {
  options: readonly InvoiceOption[];
  picked: string | undefined;
  onPick: (optionId: string | undefined) => void;
}

const RADIO_CARD =
  "flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-line-strong px-3 py-2.5 text-sm text-ink hover:bg-surface-2 has-[:checked]:border-ink has-[:checked]:bg-surface-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus";

// The network first, then the token among those it carries; a network with one token picks it at once.
export function OptionPicker({ options, picked, onPick }: Choice) {
  const current = options.find((o) => o.optionId === picked);
  const [chainId, setChainId] = useState(current?.chainId);
  const chains = [...new Set(options.map((o) => o.chainId))];
  const tokens = options.filter((o) => o.chainId === chainId);
  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm text-muted">{COPY.network}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {chains.map((id) => {
            const icon = CHAINS[id]?.icon;
            return (
              <label key={id} className={RADIO_CARD}>
                <input
                  type="radio"
                  name="pay-network"
                  className="sr-only"
                  checked={chainId === id}
                  onChange={() => {
                    setChainId(id);
                    const on = options.filter((o) => o.chainId === id);
                    onPick(on.length === 1 ? on[0]?.optionId : undefined);
                  }}
                />
                {icon ? <BrandIcon name={icon} className="size-6 shrink-0 rounded-sm" /> : null}
                {chainName(id)}
              </label>
            );
          })}
        </div>
      </fieldset>
      {tokens.length > 1 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm text-muted">{COPY.token}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {tokens.map((o) => {
              const icon = TOKEN_ICONS[o.symbol];
              return (
                <label key={o.optionId} className={RADIO_CARD}>
                  <input
                    type="radio"
                    name="pay-token"
                    className="sr-only"
                    checked={picked === o.optionId}
                    onChange={() => onPick(o.optionId)}
                  />
                  {icon ? <BrandIcon name={icon} className="size-6 shrink-0" /> : null}
                  {o.symbol}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}
