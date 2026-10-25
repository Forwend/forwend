"use client";

import { Badge, Button, TONES, useToast } from "@forwend/ui-web";
import { ROLE_LABELS, ROLES } from "@/features/profiles/constants/profile";
import { useListStoresQuery } from "@/features/stores/api/stores-api";
import { useGetTeamQuery, useRevokeInviteMutation } from "@/features/team/api/team-api";
import { InviteDialog } from "@/features/team/components/invite-dialog";
import { MemberActions } from "@/features/team/components/member-actions";
import { TEAM_COPY as COPY } from "@/features/team/constants/team-copy";
import { formatExpiry } from "@/features/team/lib/team";
import type { Invite } from "@/features/team/types/team";
import { RowsSkeleton } from "@/shared/components/rows-skeleton";

export interface TeamMembersProps {
  profileId: string;
}

const ROW = "flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-5";

// R-139: an Admin's view of the team. The owner's row has no actions: the owner is an Admin for good (D-93).
export function TeamMembers({ profileId }: TeamMembersProps) {
  const team = useGetTeamQuery(profileId);
  const stores = useListStoresQuery(profileId);
  const [revoke] = useRevokeInviteMutation();
  const toast = useToast();
  const names = new Map((stores.currentData ?? []).map((s) => [s.storeId, s.name]));
  const reach = (ids: readonly string[]) =>
    ids.length === 0
      ? COPY.everyStore
      : ids.length > 2
        ? COPY.storeCount(ids.length)
        : ids.map((id) => names.get(id) ?? id).join(", ");
  const revokeInvite = async (invite: Invite) => {
    try {
      await revoke({ profileId, inviteId: invite.inviteId }).unwrap();
      toast({ tone: TONES.success, title: COPY.revoked(invite.email) });
    } catch {
      toast({ tone: TONES.danger, title: COPY.revokeFailed });
    }
  };

  // The rows wait for the store names, so a failed stores load needs the same way out.
  const storesFailed = stores.isError && !stores.currentData;
  if ((team.isError && !team.currentData) || storesFailed) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-4 text-sm text-muted">
        {COPY.loadFailed}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            void team.refetch();
            if (storesFailed) void stores.refetch();
          }}
        >
          {COPY.retry}
        </Button>
      </div>
    );
  }
  if (!team.currentData || !stores.currentData) {
    return <RowsSkeleton count={2} className="fw-panel" />;
  }
  const { members, invites } = team.currentData;
  const storeList = stores.currentData;
  return (
    <>
      <section aria-labelledby="team-members" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="team-members" className="text-lg font-semibold text-ink">
            {COPY.members}
          </h2>
          <InviteDialog profileId={profileId} stores={storeList} />
        </div>
        <ul className="fw-panel divide-y divide-line">
          {members.map((member) => {
            const who = member.email ?? COPY.noEmail;
            return (
              <li key={member.memberId} className={ROW}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{who}</span>
                  <span className="block truncate text-sm text-muted">{reach(member.stores)}</span>
                </span>
                <Badge tone={member.role === ROLES.owner ? TONES.info : TONES.neutral}>
                  {ROLE_LABELS[member.role]}
                </Badge>
                {member.role === ROLES.owner ? null : (
                  <MemberActions
                    profileId={profileId}
                    member={member}
                    who={who}
                    stores={storeList}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <section aria-labelledby="team-invites" className="flex flex-col gap-3">
        <h2 id="team-invites" className="text-lg font-semibold text-ink">
          {COPY.invites}
        </h2>
        {invites.length === 0 ? (
          <p className="text-sm text-muted">{COPY.noInvites}</p>
        ) : (
          <ul className="fw-panel divide-y divide-line">
            {invites.map((invite) => (
              <li key={invite.inviteId} className={ROW}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{invite.email}</span>
                  <span className="block truncate text-sm text-muted">
                    {reach(invite.stores)} · {COPY.expires(formatExpiry(invite.expiresAt))}
                  </span>
                </span>
                <Badge>{ROLE_LABELS[invite.role]}</Badge>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={COPY.revokeLabel(invite.email)}
                  onClick={() => void revokeInvite(invite)}
                >
                  {COPY.revoke}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
