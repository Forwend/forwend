"use client";

import { Switch, TONES, useToast } from "@forwend/ui-web";
import { useSaveNotificationsMutation } from "@/features/profiles/api/profiles-api";
import { NOTIFICATIONS_COPY as COPY } from "@/features/profiles/constants/profiles-copy";
import type { Notifications } from "@/features/profiles/types/notifications";

export interface NotificationsFormProps {
  profileId: string;
  saved: Notifications;
}

// One switch, saved when flipped. The address is the login email and is never typed here (R-80).
export function NotificationsForm({ profileId, saved }: NotificationsFormProps) {
  const [save, { isLoading, isError }] = useSaveNotificationsMutation();
  const toast = useToast();
  const flip = async (email: boolean) => {
    try {
      await save({ profileId, email }).unwrap();
      toast({ tone: TONES.success, title: COPY.saved(email) });
    } catch {
      // Said below; the switch stays as saved.
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <Switch
        label={COPY.toggle}
        checked={saved.email}
        onCheckedChange={flip}
        disabled={isLoading}
      />
      <p className="text-sm text-muted">
        {saved.address ? COPY.to(saved.address) : COPY.noAddress}
      </p>
      {isError ? (
        <p role="alert" className="text-sm text-danger">
          {COPY.saveFailed}
        </p>
      ) : null}
    </div>
  );
}
