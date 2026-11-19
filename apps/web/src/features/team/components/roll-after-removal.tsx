"use client";

import { BUTTON_VARIANTS, buttonClasses, Dialog } from "@forwend/ui-web";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { TEAM_COPY as COPY } from "@/features/team/constants/team-copy";
import type { ToRoll } from "@/features/team/types/team";
import { APP_ROUTES } from "@/shared/config/routes";

export interface RollAfterRemovalProps {
  roll: { who: string; toRoll: ToRoll } | null;
  onClose: () => void;
}

/** A removed Admin keeps the keys and webhook secrets they copied, so the owner rolls them. */
export function RollAfterRemoval({ roll, onClose }: RollAfterRemovalProps) {
  const open = useRef<() => void>(() => {});
  useEffect(() => {
    if (roll) open.current();
  }, [roll]);
  return (
    <Dialog
      triggerLabel={roll ? COPY.rollTitle(roll.who) : ""}
      title={roll ? COPY.rollTitle(roll.who) : ""}
      onClose={onClose}
      trigger={(show) => {
        open.current = show;
        return null;
      }}
    >
      {roll ? (
        <>
          <p>{COPY.rollBody(roll.who)}</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-ink">
            {roll.toRoll.keys.map((k) => (
              <li key={k.keyId}>{COPY.rollKey(k.name, k.last4)}</li>
            ))}
            {roll.toRoll.webhooks.map((w) => (
              <li key={w.endpointId}>{COPY.rollWebhook(new URL(w.url).host)}</li>
            ))}
          </ul>
          <div className="mt-5 flex justify-end">
            <Link
              href={APP_ROUTES.developers}
              className={buttonClasses({ variant: BUTTON_VARIANTS.primary })}
            >
              {COPY.rollOpen}
            </Link>
          </div>
        </>
      ) : null}
    </Dialog>
  );
}
