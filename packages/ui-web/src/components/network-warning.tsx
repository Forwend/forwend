import { AlertTriangle } from "lucide-react";
import type { NetworkWarningProps } from "../types/payments/display";

export function NetworkWarning({ network, token }: NetworkWarningProps) {
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-lg border border-transparent bg-warning-soft p-4 text-sm text-warning"
    >
      <AlertTriangle aria-hidden className="mt-0.5 size-[var(--fw-icon-md)] shrink-0" />
      <p>
        Send only <strong>{token}</strong> on <strong>{network}</strong>. Sending another token or
        using another network may make the funds unrecoverable.
      </p>
    </div>
  );
}
