"use client";

import {
  BUTTON_VARIANTS,
  Button,
  Dialog,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  TONES,
  useToast,
} from "@forwend/ui-web";
import { Ellipsis, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { useDeleteJobMutation } from "@/features/jobs/api/jobs-api";
import { JOBS_COPY } from "@/features/jobs/constants/jobs-copy";
import type { Job } from "@/features/jobs/types/jobs";
import { APP_ROUTES } from "@/shared/config/routes";

const COPY = JOBS_COPY.detail;
const CONFLICT = 409;

export interface JobActionsProps {
  profileId: string;
  job: Job;
  /** Called once deleted, before the page leaves for the list. */
  onDeleted: () => void;
  /** Called when the client accepted it first: the refetch then takes the menu and this dialog away. */
  onTooLate: () => void;
}

// The job's actions behind one More actions menu, as a client's: Delete, while the client has not accepted it,
// confirmed in a dialog because it can't be undone. Deleting leaves for the list; too late, a toast says so, as an
// invoice's cancel does.
export function JobActions({ profileId, job, onDeleted, onTooLate }: JobActionsProps) {
  const [remove, { isLoading, error }] = useDeleteJobMutation();
  const toast = useToast();
  const router = useRouter();
  const status = (error as { status?: unknown } | undefined)?.status;
  // The dialog opens once the menu has closed, so the menu does not hand focus back to its trigger over the dialog.
  const chosen = useRef(false);

  const confirm = async () => {
    try {
      await remove({ profileId, jobId: job.jobId }).unwrap();
      onDeleted();
      toast({ tone: TONES.success, title: COPY.deleted(job.title) });
      router.push(APP_ROUTES.jobs);
    } catch (failure) {
      // Too late: the refetch that follows ends the dialog, so a toast says why. Other errors show in the dialog.
      if ((failure as { status?: unknown }).status === CONFLICT) {
        toast({ tone: TONES.warning, title: COPY.deleteTooLate });
        onTooLate();
      }
    }
  };

  return (
    <Dialog
      triggerLabel={COPY.delete}
      title={COPY.deleteTitle(job.title)}
      trigger={(openDelete) => (
        <Menu>
          <MenuTrigger asChild>
            <IconButton label={COPY.moreActions} title={COPY.moreActions} size="md">
              <Ellipsis aria-hidden className="size-[var(--fw-icon-md)]" />
            </IconButton>
          </MenuTrigger>
          <MenuContent
            align="end"
            className="w-56"
            onCloseAutoFocus={(event) => {
              if (!chosen.current) return;
              chosen.current = false;
              event.preventDefault();
              openDelete();
            }}
          >
            <MenuItem
              className="text-danger data-[highlighted]:bg-danger-soft"
              onSelect={() => {
                chosen.current = true;
              }}
            >
              <Trash2 aria-hidden className="size-[var(--fw-icon-sm)]" />
              {COPY.delete}
            </MenuItem>
          </MenuContent>
        </Menu>
      )}
    >
      <p>{COPY.deleteBody}</p>
      {error && status !== CONFLICT ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {COPY.deleteFailed}
        </p>
      ) : null}
      <form method="dialog" className="mt-5 flex flex-wrap justify-end gap-2">
        <Button type="submit" variant={BUTTON_VARIANTS.secondary}>
          {COPY.deleteKeep}
        </Button>
        <Button
          type="button"
          variant={BUTTON_VARIANTS.danger}
          loading={isLoading}
          onClick={confirm}
        >
          {COPY.delete}
        </Button>
      </form>
    </Dialog>
  );
}
