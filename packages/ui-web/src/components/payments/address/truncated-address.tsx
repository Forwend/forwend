"use client";

import { cx } from "../../../lib/cx";
import { Tooltip } from "../../overlays/tooltip";
import { shortAddress } from "./short-address";

export interface TruncatedAddressProps {
  address: string;
  className?: string;
}

export function TruncatedAddress({ address, className }: TruncatedAddressProps) {
  return (
    <Tooltip content={address}>
      <button
        type="button"
        className={cx(
          "rounded-sm font-mono outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-focus",
          className,
        )}
      >
        {shortAddress(address)}
      </button>
    </Tooltip>
  );
}
