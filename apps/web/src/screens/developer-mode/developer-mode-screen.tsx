"use client";

import { Switch, TONES, useToast } from "@forwend/ui-web";
import { useSaveProfileModeMutation } from "@/features/profiles/api/profiles-api";
import { PERMISSIONS } from "@/features/profiles/constants/profile";
import { DEVELOPER_MODE_COPY as COPY } from "@/features/profiles/constants/profiles-copy";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { can } from "@/features/profiles/lib/profile";
import { SplitSection } from "@/shared/components/split-section";

const INVALID = 422; // live mode with no mainnet switched on

/** R-221: the profile's mode. On is test mode on the testnets; off is live mode on the mainnets (D-120). */
export function DeveloperModeScreen() {
  const { profile } = useAppSession();
  const [save, { isLoading, isError, error }] = useSaveProfileModeMutation();
  const toast = useToast();
  const on = !profile.livemode;
  const allowed = can(profile, PERMISSIONS.tokensWrite);
  const flip = async (developer: boolean) => {
    try {
      await save({ profileId: profile.profileId, livemode: !developer }).unwrap();
      toast({ tone: TONES.success, title: COPY.saved(developer) });
    } catch {
      // Said below; the switch stays as saved.
    }
  };
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{COPY.title}</h1>
        <p className="text-sm text-muted">{COPY.intro}</p>
      </div>
      <SplitSection title={COPY.section} description={COPY.sectionNote}>
        <div className="fw-panel flex flex-col gap-1 px-4 py-3 sm:px-5">
          <Switch
            label={COPY.toggle}
            checked={on}
            onCheckedChange={flip}
            disabled={isLoading || !allowed}
            className="w-full flex-row-reverse justify-between font-medium text-ink"
          />
          <p className="-mt-1.5 text-sm text-muted">{on ? COPY.on : COPY.off}</p>
          <p className="pb-1 text-sm text-muted">{allowed ? COPY.kept : COPY.ownersOnly}</p>
          {isError ? (
            <p role="alert" className="pb-1 text-sm text-danger">
              {(error as { status?: unknown } | undefined)?.status === INVALID
                ? COPY.noLive
                : COPY.saveFailed}
            </p>
          ) : null}
        </div>
      </SplitSection>
    </div>
  );
}
