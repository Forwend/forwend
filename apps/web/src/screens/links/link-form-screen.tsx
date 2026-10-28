"use client";

import { Badge, Button, buttonClasses, Skeleton, TONES } from "@forwend/ui-web";
import Link from "next/link";
import { useGetLinkQuery } from "@/features/links/api/links-api";
import { LinkForm } from "@/features/links/components/link-form";
import { LINKS_COPY as COPY } from "@/features/links/constants/links-copy";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { useListStoresQuery } from "@/features/stores/api/stores-api";
import { APP_ROUTES } from "@/shared/config/routes";

export interface LinkFormScreenProps {
  /** The link to edit; a new link without one. */
  linkId?: string;
}

export function LinkFormScreen({ linkId }: LinkFormScreenProps) {
  const { profile } = useAppSession();
  const list = useGetLinkQuery(
    { profileId: profile.profileId, linkId: linkId ?? "" },
    { skip: !linkId },
  );
  const link = list.currentData;
  // A merchant's link is for one of its stores, of the ones the user reaches (R-138).
  const merchant = profile.kind === PROFILE_KINDS.merchant;
  const stores = useListStoresQuery(profile.profileId, { skip: !merchant });
  const loading =
    (linkId && !list.currentData) || (merchant && !stores.currentData && !stores.isError);
  const failed =
    (linkId && list.isError && !list.currentData) ||
    (merchant && stores.isError && !stores.currentData);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex min-w-0 flex-col gap-2">
        {/* The header's breadcrumb names the page on desktop, so the heading shows only on phones. */}
        <h1 className="text-2xl font-semibold tracking-tight break-words text-ink lg:sr-only">
          {linkId ? (link?.title ?? COPY.editTitle) : COPY.newTitle}
        </h1>
        <p className="text-muted">{COPY.intro}</p>
        {link && !link.livemode ? (
          <span>
            <Badge tone={TONES.warning}>{COPY.testMode}</Badge>
          </span>
        ) : null}
      </header>
      {failed ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-muted">
          {COPY.failed}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              if (list.isError) void list.refetch();
              if (stores.isError) void stores.refetch();
            }}
          >
            {COPY.retry}
          </Button>
        </div>
      ) : loading ? (
        <Skeleton className="h-96" />
      ) : merchant && stores.currentData?.length === 0 ? (
        <p role="status" className="text-sm text-muted">
          {COPY.noStores}
        </p>
      ) : !linkId || link ? (
        // A new form per link, so it never keeps another link's values.
        <LinkForm
          key={link?.linkId ?? profile.profileId}
          profileId={profile.profileId}
          link={link}
          stores={stores.currentData ?? []}
        />
      ) : (
        <div className="flex flex-col items-start gap-3 text-sm text-muted">
          {COPY.gone}
          <Link
            href={APP_ROUTES.links}
            className={buttonClasses({ size: "sm", variant: "secondary" })}
          >
            {COPY.backToList}
          </Link>
        </div>
      )}
    </div>
  );
}
