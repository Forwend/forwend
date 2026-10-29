"use client";

import { BUTTON_VARIANTS, Button, Dialog, TONES, useToast } from "@forwend/ui-web";
import { useRouter } from "next/navigation";
import { useLeaveTeamMutation } from "@/features/team/api/team-api";
import { TEAM_COPY as COPY } from "@/features/team/constants/team-copy";
import { APP_ROUTES } from "@/shared/config/routes";

export interface LeaveTeamProps {
  profileId: string;
  /** The team's name, as the profile switcher shows it. */
  team: string;
}

// D-93: any member may leave; the owner can't, so the app offers it only to members.
export function LeaveTeam({ profileId, team }: LeaveTeamProps) {
  const [leave, { isLoading, isError, reset }] = useLeaveTeamMutation();
  const toast = useToast();
  const router = useRouter();
  const confirm = async () => {
    try {
      await leave(profileId).unwrap();
      toast({ tone: TONES.success, title: COPY.left(team) });
      router.push(APP_ROUTES.home);
    } catch {
      // The dialog shows the error.
    }
  };
  return (
    <Dialog
      triggerLabel={COPY.leave}
      title={COPY.leaveTitle(team)}
      triggerVariant={BUTTON_VARIANTS.secondary}
      triggerClassName="shrink-0 max-sm:w-full"
      onClose={reset}
    >
      <p>{COPY.leaveBody}</p>
      {isError ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {COPY.leaveFailed}
        </p>
      ) : null}
      <form method="dialog" className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="submit" variant={BUTTON_VARIANTS.secondary}>
          {COPY.stay}
        </Button>
        <Button
          type="button"
          variant={BUTTON_VARIANTS.danger}
          loading={isLoading}
          onClick={() => void confirm()}
        >
          {COPY.leave}
        </Button>
      </form>
    </Dialog>
  );
}
