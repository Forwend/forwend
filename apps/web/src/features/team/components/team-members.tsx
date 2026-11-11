"use client";

import {
  Badge,
  Button,
  cx,
  Skeleton,
  TABLE_HEAD_CLASSES,
  TABLE_ROW_CLASSES,
  TONES,
  useToast,
} from "@forwend/ui-web";
import { useState } from "react";
import { ROLE_LABELS, ROLES } from "@/features/profiles/constants/profile";
import { useListStoresQuery } from "@/features/stores/api/stores-api";
import { useGetTeamQuery, useRevokeInviteMutation } from "@/features/team/api/team-api";
import { InviteDialog } from "@/features/team/components/invite-dialog";
import { MemberActions } from "@/features/team/components/member-actions";
import { RollAfterRemoval } from "@/features/team/components/roll-after-removal";
import { TEAM_COPY as COPY } from "@/features/team/constants/team-copy";
import { formatExpiry } from "@/features/team/lib/team";
import type { Invite, ToRoll } from "@/features/team/types/team";
import { LoadError } from "@/shared/components/load-error";

export interface TeamMembersProps {
  profileId: string;
}

// The panel's width decides, not the screen's: below it a row keeps the person, the role and the actions.
const WIDE = "hidden @2xl:table-cell";
const NARROW = "block truncate text-xs text-muted @2xl:hidden";
const ROW = cx(TABLE_ROW_CLASSES, "max-sm:[&>td:first-child]:pl-4 max-sm:[&>td:last-child]:pr-3");

// R-139: an Admin's view of the team. The owner's row has no actions: the owner is an Admin for good (D-93).
export function TeamMembers({ profileId }: TeamMembersProps) {
  const team = useGetTeamQuery(profileId);
  const stores = useListStoresQuery(profileId);
  const [revoke, revoking] = useRevokeInviteMutation();
  const toast = useToast();
  // Here, not in the member's row: removing them takes the row and its dialogs away.
  const [roll, setRoll] = useState<{ who: string; toRoll: ToRoll } | null>(null);
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
      <LoadError
        message={COPY.loadFailed}
        retrying={team.isFetching || stores.isFetching}
        onRetry={() => {
          void team.refetch();
          if (storesFailed) void stores.refetch();
        }}
      />
    );
  }
  const loaded = team.currentData && stores.currentData ? team.currentData : null;
  const storeList = stores.currentData ?? [];
  return (
    <>
      <section aria-labelledby="team-members" className="fw-panel @container">
        <div className="fw-panel-head justify-between">
          <h2 id="team-members" className="text-base font-semibold text-ink">
            {COPY.members}
          </h2>
          {loaded ? <InviteDialog profileId={profileId} stores={storeList} /> : null}
        </div>
        {!loaded ? (
          <RowsSkeleton />
        ) : (
          <table className="w-full table-fixed text-sm">
            <thead className="hidden @2xl:table-header-group">
              <tr className={TABLE_HEAD_CLASSES}>
                <th scope="col">{COPY.columns.member}</th>
                <th scope="col" className="w-[30%]">
                  {COPY.columns.stores}
                </th>
                <th scope="col" className="w-28">
                  {COPY.columns.role}
                </th>
                <th scope="col" className="w-14">
                  <span className="sr-only">{COPY.columns.actions}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loaded.members.map((member) => {
                const who = member.email ?? COPY.noEmail;
                return (
                  <tr key={member.memberId} className={ROW}>
                    <td>
                      <span
                        className={cx(
                          "block truncate font-medium",
                          member.email ? "text-ink" : "text-muted",
                        )}
                      >
                        {who}
                      </span>
                      <span className={NARROW}>{reach(member.stores)}</span>
                    </td>
                    <td className={cx(WIDE, "truncate text-muted")}>{reach(member.stores)}</td>
                    <td className="w-28 @max-2xl:text-right">
                      <Badge tone={member.role === ROLES.owner ? TONES.info : TONES.neutral}>
                        {ROLE_LABELS[member.role]}
                      </Badge>
                    </td>
                    <td className="w-14">
                      {/* Not text-right: the row's dialogs live in this cell and would inherit it. */}
                      <div className="flex justify-end">
                        {member.role === ROLES.owner ? null : (
                          <MemberActions
                            profileId={profileId}
                            member={member}
                            who={who}
                            stores={storeList}
                            onToRoll={(toRoll) => setRoll({ who, toRoll })}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      <section aria-labelledby="team-invites" className="fw-panel @container">
        <h2 id="team-invites" className="fw-panel-head text-base font-semibold text-ink">
          {COPY.invites}
        </h2>
        {!loaded ? (
          <RowsSkeleton />
        ) : loaded.invites.length === 0 ? (
          <p className="px-4 py-3.5 text-sm text-muted sm:px-5">{COPY.noInvites}</p>
        ) : (
          <table className="w-full table-fixed text-sm">
            <thead className="hidden @2xl:table-header-group">
              <tr className={TABLE_HEAD_CLASSES}>
                <th scope="col">{COPY.columns.email}</th>
                <th scope="col" className="w-[24%]">
                  {COPY.columns.stores}
                </th>
                <th scope="col" className="w-[24%]">
                  {COPY.columns.expires}
                </th>
                <th scope="col" className="w-28">
                  {COPY.columns.role}
                </th>
                <th scope="col" className="w-24">
                  <span className="sr-only">{COPY.columns.actions}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loaded.invites.map((invite) => (
                <tr key={invite.inviteId} className={ROW}>
                  <td>
                    <span className="block truncate font-medium text-ink">{invite.email}</span>
                    <span className={NARROW}>
                      {ROLE_LABELS[invite.role]} · {reach(invite.stores)}
                    </span>
                    <span className={NARROW}>{COPY.expires(formatExpiry(invite.expiresAt))}</span>
                  </td>
                  <td className={cx(WIDE, "truncate text-muted")}>{reach(invite.stores)}</td>
                  <td className={cx(WIDE, "truncate text-muted tabular-nums")}>
                    {formatExpiry(invite.expiresAt)}
                  </td>
                  <td className={WIDE}>
                    <Badge>{ROLE_LABELS[invite.role]}</Badge>
                  </td>
                  <td className="w-24 text-right">
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={COPY.revokeLabel(invite.email)}
                      loading={
                        revoking.isLoading && revoking.originalArgs?.inviteId === invite.inviteId
                      }
                      onClick={() => void revokeInvite(invite)}
                    >
                      {COPY.revoke}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <RollAfterRemoval roll={roll} onClose={() => setRoll(null)} />
    </>
  );
}

function RowsSkeleton() {
  return (
    <ul aria-hidden className="divide-y divide-line">
      {[0, 1].map((i) => (
        <li key={i} className="flex h-14 items-center gap-6 px-4 sm:px-5">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="hidden h-4 w-28 @2xl:block" />
          <Skeleton className="ml-auto h-6 w-20" />
        </li>
      ))}
    </ul>
  );
}
