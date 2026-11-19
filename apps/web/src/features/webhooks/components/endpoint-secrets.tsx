import { Button } from "@forwend/ui-web";
import { WEBHOOKS_COPY as COPY } from "@/features/webhooks/constants/webhooks-copy";
import type { WebhookSecret } from "@/features/webhooks/types/webhooks";
import { CopyValue } from "@/shared/components/copy-value";
import { dateTime } from "@/shared/lib/dates";

export interface EndpointSecretsProps {
  secrets: readonly WebhookSecret[];
  onDone: () => void;
}

export function EndpointSecrets({ secrets, onDone }: EndpointSecretsProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink">{COPY.secretBody}</p>
      {secrets.map((s, i) => (
        <CopyValue
          key={s.createdAt}
          label={i === 0 ? COPY.secretLabel : COPY.oldSecretLabel}
          value={s.secret}
          hint={s.expiresAt ? COPY.signsUntil(dateTime(s.expiresAt)) : COPY.newestHint}
          copyLabel={i === 0 ? COPY.copyLabel : COPY.copyOldLabel}
        />
      ))}
      <div className="flex justify-end">
        <Button onClick={onDone}>{COPY.done}</Button>
      </div>
    </div>
  );
}
