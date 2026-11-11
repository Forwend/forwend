"use client";

import {
  PERMISSIONS,
  PROFILE_KINDS,
  ROLE_LABELS,
  ROLES,
} from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { can, profileLabel } from "@/features/profiles/lib/profile";
import { LeaveTeam } from "@/features/team/components/leave-team";
import { TeamMembers } from "@/features/team/components/team-members";
import { TEAM_COPY as COPY } from "@/features/team/constants/team-copy";
import { SETTINGS_ROW, SETTINGS_TITLE } from "@/shared/components/settings-group";

// R-139: an Admin manages the team here; every member sees their role and may leave.
export function TeamScreen() {
  const { profile } = useAppSession();
  return (
    <div className="flex flex-col gap-6">
      <h1 className={SETTINGS_TITLE}>{COPY.title}</h1>
      {profile.kind !== PROFILE_KINDS.merchant ? (
        <p className="text-sm text-muted">{COPY.notMerchant}</p>
      ) : (
        <>
          {profile.role === ROLES.owner ? null : (
            <div className={`fw-panel ${SETTINGS_ROW}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">
                  {COPY.yourRole(ROLE_LABELS[profile.role])}
                </p>
                <p className="mt-0.5 text-sm text-muted">{COPY.yourRoleHint}</p>
              </div>
              <LeaveTeam profileId={profile.profileId} team={profileLabel(profile)} />
            </div>
          )}
          {can(profile, PERMISSIONS.team) ? (
            <TeamMembers key={profile.profileId} profileId={profile.profileId} />
          ) : null}
        </>
      )}
    </div>
  );
}
