"use client";

import { cx } from "../../../lib/cx";
import { Tooltip } from "../../overlays/tooltip";
import { shortAddress } from "./short-address";

export interface TruncatedAddressProps {
  address: string;
  /** false: the app's text font, for an address among other text such as a review. */
  mono?: boolean;
  className?: string;
}

export function TruncatedAddress({ address, mono = true, className }: TruncatedAddressProps) {
  return (
    <Tooltip content={address}>
      <button
        type="button"
        className={cx(
          "rounded-sm outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-focus",
          mono && "font-mono",
          className,
        )}
      >
        {shortAddress(address)}
      </button>
    </Tooltip>
  );
}
