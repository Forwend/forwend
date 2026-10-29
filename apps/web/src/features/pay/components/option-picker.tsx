"use client";

import { ComboboxField, type ComboboxOption, SelectField, shortAddress } from "@forwend/ui-web";
import { useState } from "react";
import type { InvoiceOption } from "@/features/invoices/types/invoices";
import { PAY_COPY as COPY } from "@/features/pay/constants/pay-copy";
import { AssetIcon } from "@/shared/components/chains/asset-icon";
import { chainName, TOKEN_SEARCH_FROM } from "@/shared/lib/chains";

export interface Choice {
  options: readonly InvoiceOption[];
  picked: string | undefined;
  onPick: (optionId: string | undefined) => void;
}

export function onlyOptionOn(
  options: readonly InvoiceOption[],
  chainId: number,
): string | undefined {
  const on = options.filter((o) => o.chainId === chainId);
  return on.length === 1 ? on[0]?.optionId : undefined;
}

// Selects, not cards: the list grows with every chain and token added (R-68).
export function OptionPicker({ options, picked, onPick }: Choice) {
  const current = options.find((o) => o.optionId === picked);
  const [chainId, setChainId] = useState(current?.chainId);
  const chains = [...new Set(options.map((o) => o.chainId))];
  const tokens = options.filter((o) => o.chainId === chainId);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Pick
        label={COPY.network}
        searchLabel={COPY.searchNetworks}
        placeholder={COPY.chooseNetwork}
        value={chainId === undefined ? undefined : String(chainId)}
        onValueChange={(value) => {
          const id = Number(value);
          setChainId(id);
          onPick(onlyOptionOn(options, id));
        }}
        options={chains.map((id) => ({
          value: String(id),
          label: chainName(id),
          icon: <AssetIcon chainId={id} />,
        }))}
      />
      <Pick
        label={COPY.token}
        searchLabel={COPY.searchTokens}
        placeholder={COPY.chooseToken}
        disabled={tokens.length === 0}
        value={current?.optionId}
        onValueChange={onPick}
        options={tokens.map((o) => ({
          value: o.optionId,
          label: o.symbol,
          // The exact contract, so a look-alike token with the same symbol can't pass for this one.
          detail: shortAddress(o.token),
          icon: <AssetIcon chainId={o.chainId} symbol={o.symbol} />,
        }))}
      />
    </div>
  );
}

// A long list gets a search; a short one stays a plain select.
function Pick({
  label,
  searchLabel,
  placeholder,
  value,
  onValueChange,
  options,
  disabled,
}: {
  label: string;
  searchLabel: string;
  placeholder: string;
  value: string | undefined;
  onValueChange: (value: string) => void;
  options: readonly ComboboxOption[];
  disabled?: boolean;
}) {
  return options.length > TOKEN_SEARCH_FROM ? (
    <ComboboxField
      label={label}
      searchLabel={searchLabel}
      noResults={COPY.noMatch}
      placeholder={placeholder}
      value={value ?? ""}
      onValueChange={onValueChange}
      options={options}
    />
  ) : (
    <SelectField
      label={label}
      placeholder={placeholder}
      disabled={disabled}
      value={value}
      onValueChange={onValueChange}
      options={options}
    />
  );
}
