"use client";

import { Skeleton } from "@forwend/ui-web";
import { useGetNotificationsQuery } from "@/features/profiles/api/profiles-api";
import { NotificationsForm } from "@/features/profiles/components/notifications-form";
import { NOTIFICATIONS_COPY as COPY } from "@/features/profiles/constants/profiles-copy";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { LoadError } from "@/shared/components/load-error";
import { SETTINGS_TITLE, SettingsGroup } from "@/shared/components/settings-group";

export function NotificationsScreen() {
  const { profile } = useAppSession();
  const settings = useGetNotificationsQuery(profile.profileId);
  return (
    <div className="flex flex-col gap-6">
      <h1 className={SETTINGS_TITLE}>{COPY.title}</h1>
      <SettingsGroup note={COPY.note}>
        {settings.isError ? (
          <LoadError
            message={COPY.loadFailed}
            retrying={settings.isFetching}
            onRetry={() => void settings.refetch()}
          />
        ) : settings.currentData === undefined ? (
          <div aria-hidden className="fw-panel flex flex-col gap-2 px-4 py-4 sm:px-5">
            <span className="flex items-center justify-between gap-4">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-6 w-11 rounded-pill" />
            </span>
            <Skeleton className="h-3 w-48 max-w-full" />
          </div>
        ) : (
          <NotificationsForm
            key={profile.profileId}
            profileId={profile.profileId}
            saved={settings.currentData}
          />
        )}
      </SettingsGroup>
    </div>
  );
}
