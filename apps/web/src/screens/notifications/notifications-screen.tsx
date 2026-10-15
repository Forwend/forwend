"use client";

import { Button, Skeleton } from "@forwend/ui-web";
import { useGetNotificationsQuery } from "@/features/profiles/api/profiles-api";
import { NotificationsForm } from "@/features/profiles/components/notifications-form";
import { NOTIFICATIONS_COPY as COPY } from "@/features/profiles/constants/profiles-copy";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";

export function NotificationsScreen() {
  const { profile } = useAppSession();
  const settings = useGetNotificationsQuery(profile.profileId);
  return (
    <div className="flex max-w-md flex-col gap-8">
      <div className="flex flex-col gap-2">
        {/* The header's breadcrumb names the page on desktop, so the heading shows only on phones. */}
        <h1 className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">{COPY.title}</h1>
        <p className="text-muted">{COPY.intro}</p>
      </div>
      {settings.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-muted">
          {COPY.loadFailed}
          <Button size="sm" variant="secondary" onClick={settings.refetch}>
            {COPY.retry}
          </Button>
        </div>
      ) : settings.currentData === undefined ? (
        <Skeleton className="h-24" />
      ) : (
        <NotificationsForm
          key={profile.profileId}
          profileId={profile.profileId}
          saved={settings.currentData}
        />
      )}
    </div>
  );
}
