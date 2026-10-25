"use client";

import { Badge, Button, Dialog, EmptyState, TONES } from "@forwend/ui-web";
import { KeyRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useListKeysQuery } from "@/features/api-keys/api/api-keys-api";
import { KeyActions } from "@/features/api-keys/components/key-actions";
import { KeySecret } from "@/features/api-keys/components/key-secret";
import { NewKeyDialog } from "@/features/api-keys/components/new-key-dialog";
import { API_KEYS_COPY as COPY } from "@/features/api-keys/constants/api-keys-copy";
import { useListStoresQuery } from "@/features/stores/api/stores-api";
import { RowsSkeleton } from "@/shared/components/rows-skeleton";

export interface ApiKeysProps {
  profileId: string;
  /** A merchant's keys are each for one of its stores; a freelancer has none. */
  merchant: boolean;
}

const ROW = "flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-5";
const WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

// R-145: the profile's working keys, newest first, each with its last use and, once rolled, when it stops.
export function ApiKeys({ profileId, merchant }: ApiKeysProps) {
  const keys = useListKeysQuery(profileId);
  const stores = useListStoresQuery(profileId, { skip: !merchant });
  const names = new Map((stores.currentData ?? []).map((s) => [s.storeId, s.name]));
  // A made or rolled key's text, the one time the API answers it. It lives here, not in a row: a roll with no
  // overlap takes the old key's row away. Closing the dialog drops it for good.
  const [secret, setSecret] = useState<string | null>(null);
  const openSecret = useRef<() => void>(null);
  const secretBody = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!secret) return;
    openSecret.current?.();
    // Copy takes the focus: it is what the person came for.
    secretBody.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [secret]);

  if (keys.isError && !keys.currentData) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-4 text-sm text-muted">
        {COPY.loadFailed}
        <Button size="sm" variant="secondary" onClick={() => void keys.refetch()}>
          {COPY.retry}
        </Button>
      </div>
    );
  }
  if (!keys.currentData || (merchant && !stores.currentData)) {
    return <RowsSkeleton count={2} className="fw-panel" />;
  }
  const list = keys.currentData;
  return (
    <section aria-labelledby="api-keys" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="api-keys" className="text-lg font-semibold text-ink">
          {COPY.keys}
        </h2>
        <NewKeyDialog
          profileId={profileId}
          stores={merchant ? (stores.currentData ?? []) : null}
          onMade={setSecret}
        />
      </div>
      {list.length === 0 ? (
        <EmptyState icon={KeyRound} title={COPY.empty} description={COPY.emptyBody} />
      ) : (
        <ul className="fw-panel divide-y divide-line">
          {list.map((key) => (
            <li key={key.keyId} className={ROW}>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{key.name}</span>
                <span className="block text-sm break-words text-muted">
                  <code className="font-mono">{COPY.keyText(key.last4)}</code>
                  {key.storeId ? ` · ${names.get(key.storeId) ?? key.storeId}` : null}
                  {" · "}
                  {key.scopes.map((scope) => COPY.scopeLabels[scope]).join(", ")}
                </span>
                <span className="block text-sm text-muted">
                  {key.lastUsedAt
                    ? COPY.lastUsed(WHEN.format(new Date(key.lastUsedAt)))
                    : COPY.neverUsed}
                  {key.expiresAt ? ` · ${COPY.stops(WHEN.format(new Date(key.expiresAt)))}` : null}
                </span>
              </span>
              {key.livemode ? null : <Badge tone={TONES.warning}>{COPY.testMode}</Badge>}
              <KeyActions profileId={profileId} apiKey={key} onRolled={setSecret} />
            </li>
          ))}
        </ul>
      )}
      <Dialog
        triggerLabel={COPY.secretTitle}
        title={COPY.secretTitle}
        onClose={() => setSecret(null)}
        trigger={(open) => {
          openSecret.current = open;
          return null;
        }}
      >
        <div ref={secretBody}>
          {secret ? (
            <KeySecret
              secret={secret}
              onDone={() => secretBody.current?.closest("dialog")?.close()}
            />
          ) : null}
        </div>
      </Dialog>
    </section>
  );
}
