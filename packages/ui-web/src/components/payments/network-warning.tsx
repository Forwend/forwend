import { AlertTriangle } from "lucide-react";

export interface NetworkWarningProps {
  network: string;
  token: string;
  /** A bridged token with the same name on this network, such as USDC.e for USDC on Arbitrum. */
  lookalike?: string;
}

export function NetworkWarning({ network, token, lookalike }: NetworkWarningProps) {
  return (
    <div role="note" className="flex items-start gap-2.5 text-xs leading-relaxed text-warning">
      <AlertTriangle aria-hidden className="mt-0.5 size-[var(--fw-icon-sm)] shrink-0" />
      <p>
        Send only <strong>{token}</strong> on <strong>{network}</strong>.
        {lookalike ? (
          <>
            {" "}
            Native {token}, not {lookalike}.
          </>
        ) : null}{" "}
        Sending another token or using another network may make the funds unrecoverable.
      </p>
    </div>
  );
}
