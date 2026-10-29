import { Button } from "@forwend/ui-web";
import { API_KEYS_COPY as COPY } from "@/features/api-keys/constants/api-keys-copy";
import { CopyValue } from "@/shared/components/copy-value";

export interface KeySecretProps {
  secret: string;
  onDone: () => void;
}

// R-144: the API answers a key's text once, so this is the only place it shows.
export function KeySecret({ secret, onDone }: KeySecretProps) {
  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
        {COPY.secretBody}
      </p>
      <CopyValue
        label={COPY.secretLabel}
        value={secret}
        hint={COPY.secretHint}
        copyLabel={COPY.copyLabel}
      />
      <div className="flex flex-col sm:flex-row sm:justify-end">
        <Button onClick={onDone}>{COPY.done}</Button>
      </div>
    </div>
  );
}
