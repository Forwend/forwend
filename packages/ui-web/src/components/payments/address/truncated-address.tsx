"use client";

import { cx } from "../../../lib/cx";
import { Tooltip } from "../../overlays/tooltip";
import { shortAddress } from "./short-address";

export interface TruncatedAddressProps {
  address: string;
  className?: string;
}

/** An address cut to its start and end in a row of details; hover, focus or a tap shows it whole. */
export function TruncatedAddress({ address, className }: TruncatedAddressProps) {
  return (
    <Tooltip content={address}>
      <button
        type="button"
        aria-label={address}
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
