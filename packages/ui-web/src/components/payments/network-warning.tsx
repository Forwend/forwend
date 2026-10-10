import { AlertTriangle } from "lucide-react";

export interface NetworkWarningProps {
  network: string;
  token: string;
}

export function NetworkWarning({ network, token }: NetworkWarningProps) {
  return (
    <div
      role="note"
      className="flex items-start gap-2.5 rounded-md bg-warning-soft px-3 py-2.5 text-sm text-warning"
    >
      <AlertTriangle aria-hidden className="mt-0.5 size-[var(--fw-icon-sm)] shrink-0" />
      <p>
        Send only <strong>{token}</strong> on <strong>{network}</strong>. Sending another token or
        using another network may make the funds unrecoverable.
      </p>
    </div>
  );
}
