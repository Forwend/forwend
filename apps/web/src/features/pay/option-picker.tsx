"use client";

import { SelectField } from "@forwend/ui-web";
import { useState } from "react";
import type { InvoiceOption } from "@/features/invoices/invoices";
import { PAY_COPY as COPY } from "@/features/pay/pay-copy";
import { chainName } from "@/shared/chains/chains";

export interface Choice {
  options: readonly InvoiceOption[];
  picked: string | undefined;
  onPick: (optionId: string | undefined) => void;
}

/** The option a network picks by itself: its only token, else none until the payer picks the token. */
export function onlyOptionOn(
  options: readonly InvoiceOption[],
  chainId: number,
): string | undefined {
  const on = options.filter((o) => o.chainId === chainId);
  return on.length === 1 ? on[0]?.optionId : undefined;
}

// Selects, not cards: the list grows with every chain and token added (R-68). The network first, then the token among
// those it carries; a network with one token picks it at once.
export function OptionPicker({ options, picked, onPick }: Choice) {
  const current = options.find((o) => o.optionId === picked);
  const [chainId, setChainId] = useState(current?.chainId);
  const chains = [...new Set(options.map((o) => o.chainId))];
  const tokens = options.filter((o) => o.chainId === chainId);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <SelectField
        label={COPY.network}
        placeholder={COPY.chooseNetwork}
        value={chainId === undefined ? undefined : String(chainId)}
        onValueChange={(value) => {
          const id = Number(value);
          setChainId(id);
          onPick(onlyOptionOn(options, id));
        }}
        options={chains.map((id) => ({ value: String(id), label: chainName(id) }))}
      />
      <SelectField
        label={COPY.token}
        placeholder={COPY.chooseToken}
        disabled={tokens.length === 0}
        value={current?.optionId}
        onValueChange={onPick}
        options={tokens.map((o) => ({ value: o.optionId, label: o.symbol }))}
      />
    </div>
  );
}
