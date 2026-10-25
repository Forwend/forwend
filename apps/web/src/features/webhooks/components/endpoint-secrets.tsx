import { Button } from "@forwend/ui-web";
import { WEBHOOKS_COPY as COPY } from "@/features/webhooks/constants/webhooks-copy";
import type { WebhookSecret } from "@/features/webhooks/types/webhooks";
import { CopyValue } from "@/shared/components/copy-value";

export interface EndpointSecretsProps {
  /** Newest first: during a rotation's 24 hours the old one signs too. */
  secrets: readonly WebhookSecret[];
  onDone: () => void;
}

const WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

// R-149: shown only after a fresh sign-in, and dropped from the page once closed.
export function EndpointSecrets({ secrets, onDone }: EndpointSecretsProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink">{COPY.secretBody}</p>
      {secrets.map((s, i) => (
        <CopyValue
          key={s.createdAt}
          label={i === 0 ? COPY.secretLabel : COPY.oldSecretLabel}
          value={s.secret}
          hint={s.expiresAt ? COPY.signsUntil(WHEN.format(new Date(s.expiresAt))) : COPY.newestHint}
          copyLabel={i === 0 ? COPY.copyLabel : COPY.copyOldLabel}
        />
      ))}
      <div className="flex justify-end">
        <Button onClick={onDone}>{COPY.done}</Button>
      </div>
    </div>
  );
}
