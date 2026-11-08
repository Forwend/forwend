"use client";

import { Button } from "@forwend/ui-web";
import { useSaveProfileModeMutation } from "@/features/profiles/api/profiles-api";
import { PERMISSIONS } from "@/features/profiles/constants/profile";
import { DEVELOPER_MODE_COPY as COPY } from "@/features/profiles/constants/profiles-copy";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { can } from "@/features/profiles/lib/profile";

const INVALID = 422; // live mode with no mainnet switched on

/** Under a page that found nothing, such as an email's link to an invoice of the other mode (R-221): the way there. */
export function OtherModeHint() {
  const { profile } = useAppSession();
  const [save, { isLoading, isError, error }] = useSaveProfileModeMutation();
  const developer = !profile.livemode;
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-muted">{COPY.otherMode(developer)}</p>
      {can(profile, PERMISSIONS.tokensWrite) ? (
        <Button
          variant="secondary"
          size="sm"
          loading={isLoading}
          onClick={() => void save({ profileId: profile.profileId, livemode: developer })}
        >
          {COPY.switchMode(developer)}
        </Button>
      ) : null}
      {isError ? (
        <p role="alert" className="text-sm text-danger">
          {(error as { status?: unknown } | undefined)?.status === INVALID
            ? COPY.noLive
            : COPY.saveFailed}
        </p>
      ) : null}
    </div>
  );
}
