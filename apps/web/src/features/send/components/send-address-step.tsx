"use client";

import { Button, IconButton, TextField } from "@forwend/ui-web";
import { X } from "lucide-react";
import { ADDRESS_LENGTH } from "@/features/send/constants/send";
import { SEND_COPY } from "@/features/send/constants/send-copy";
import { isWalletAddress } from "@/features/send/lib/send";

export interface SendAddressStepProps {
  address: string;
  error: string | null;
  onAddress: (address: string) => void;
  onError: (error: string | null) => void;
  onContinue: (address: string) => void;
}

export function SendAddressStep({
  address,
  error,
  onAddress,
  onError,
  onContinue,
}: SendAddressStepProps) {
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!isWalletAddress(address)) {
          onError(SEND_COPY.addressInvalid);
          return;
        }
        onContinue(address.trim());
      }}
      className="flex flex-col gap-5"
    >
      <TextField
        label={SEND_COPY.walletAddress}
        labelHidden
        placeholder={SEND_COPY.addressPlaceholder}
        value={address}
        autoFocus
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        inputClassName="font-mono"
        onChange={(e) => {
          onAddress(e.target.value);
          onError(null);
        }}
        onBlur={() => {
          if (address.trim() && !isWalletAddress(address)) onError(SEND_COPY.addressInvalid);
        }}
        hint={SEND_COPY.addressHint}
        error={
          error ??
          (address.trim().length >= ADDRESS_LENGTH && !isWalletAddress(address)
            ? SEND_COPY.addressInvalid
            : undefined)
        }
        end={
          address ? (
            <IconButton
              label={SEND_COPY.clearAddress}
              onClick={() => {
                onAddress("");
                onError(null);
              }}
            >
              <X aria-hidden className="size-[var(--fw-icon-sm)]" />
            </IconButton>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                const text = await navigator.clipboard?.readText().catch(() => "");
                if (text) onAddress(text.trim());
              }}
            >
              {SEND_COPY.paste}
            </Button>
          )
        }
      />
      <Button type="submit" className="w-full" disabled={!isWalletAddress(address)}>
        {SEND_COPY.continue}
      </Button>
    </form>
  );
}
