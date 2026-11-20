"use client";

import { Badge, Button, type ButtonSize, buttonClasses, EmptyState, TONES } from "@forwend/ui-web";
import { Link2, Plus } from "lucide-react";
import Link from "next/link";
import { useListLinksInfiniteQuery } from "@/features/links/api/links-api";
import { LINK_STATES } from "@/features/links/constants/links";
import { LINKS_COPY as COPY } from "@/features/links/constants/links-copy";
import { amountLabel, linkState } from "@/features/links/lib/links";
import type { Link as PaymentLink } from "@/features/links/types/links";
import { DataTable, DataTableSkeleton } from "@/shared/components/data-table";
import { ListToolbar } from "@/shared/components/list-toolbar";
import { LoadError } from "@/shared/components/load-error";
import { PageTitle } from "@/shared/components/page-title";
import { APP_ROUTES } from "@/shared/config/routes";

const linkHref = (link: PaymentLink) => `${APP_ROUTES.links}/${link.linkId}`;

function NewLinkLink({ className = "", size = "md" }: { className?: string; size?: ButtonSize }) {
  return (
    <Link href={APP_ROUTES.newLink} className={`${buttonClasses({ size })} ${className}`}>
      <Plus aria-hidden className="size-[var(--fw-icon-sm)]" />
      {COPY.add}
    </Link>
  );
}

function StateBadge({ link }: { link: PaymentLink }) {
  const state = linkState(link, Date.now());
  return (
    <span className="inline-flex flex-wrap gap-2">
      <Badge tone={state === LINK_STATES.on ? TONES.success : TONES.neutral}>
        {COPY.states[state]}
      </Badge>
      {link.livemode ? null : <Badge tone={TONES.neutral}>{COPY.testMode}</Badge>}
    </span>
  );
}

export interface LinksTableProps {
  profileId: string;
  canWrite: boolean;
}

export function LinksTable({ profileId, canWrite }: LinksTableProps) {
  const list = useListLinksInfiniteQuery(profileId);
  const links = list.currentData?.pages.flatMap((page) => page.links) ?? [];
  const noLinks = Boolean(list.currentData) && links.length === 0;
  return (
    <section
      aria-labelledby="links-title"
      aria-busy={!list.currentData && !list.isError}
      className="flex flex-col gap-4"
    >
      <div className="flex items-center justify-between gap-3 lg:contents">
        <PageTitle id="links-title">{COPY.title}</PageTitle>
        {canWrite && !noLinks ? <NewLinkLink size="sm" className="lg:hidden" /> : null}
      </div>
      {noLinks ? null : (
        <ListToolbar
          search={<p className="flex-1 text-sm text-muted">{COPY.intro}</p>}
          actions={canWrite ? <NewLinkLink className="max-lg:hidden" /> : undefined}
        />
      )}

      {list.isError && !list.currentData ? (
        <LoadError
          page
          message={COPY.failed}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : !list.currentData ? (
        <DataTableSkeleton count={2} className="fw-panel" />
      ) : links.length === 0 ? (
        <EmptyState
          page
          icon={Link2}
          title={COPY.empty}
          description={COPY.emptyBody}
          action={canWrite ? <NewLinkLink /> : undefined}
        />
      ) : (
        <DataTable
          label={COPY.title}
          rows={links}
          rowKey={(link) => link.linkId}
          rowHref={linkHref}
          rowLabel={(link) => link.title}
          columns={[
            {
              key: "link",
              header: COPY.columns.link,
              className: "w-[30%]",
              cell: (link) => <span className="font-medium text-ink">{link.title}</span>,
            },
            {
              key: "address",
              header: COPY.columns.address,
              from: "md",
              cell: (link) => <span className="font-mono text-xs text-muted">/l/{link.slug}</span>,
            },
            { key: "amount", header: COPY.columns.amount, cell: (link) => amountLabel(link) },
            {
              key: "status",
              header: COPY.columns.status,
              cell: (link) => <StateBadge link={link} />,
            },
            {
              key: "activity",
              header: COPY.columns.activity,
              from: "lg",
              cell: (link) => (
                <span className="text-muted">
                  {COPY.activity(link.visits, link.paid, link.reserved)}
                </span>
              ),
            },
          ]}
          phone={(link) => ({
            title: link.title,
            detail: `${amountLabel(link)} · ${COPY.activity(link.visits, link.paid, link.reserved)}`,
            meta: <StateBadge link={link} />,
          })}
          footer={
            list.hasNextPage ? (
              <Button
                variant="secondary"
                size="sm"
                loading={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {COPY.loadMore}
              </Button>
            ) : undefined
          }
        />
      )}
      {list.error && list.currentData ? (
        <LoadError
          inline
          message={COPY.updateFailed}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : null}
    </section>
  );
}
