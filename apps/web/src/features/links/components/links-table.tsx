"use client";

import {
  Badge,
  Button,
  type ButtonSize,
  buttonClasses,
  EmptyState,
  ROW_INTERACTIVE_CLASSES,
  TABLE_HEAD_CLASSES,
  TABLE_ROW_CLASSES,
  TONES,
} from "@forwend/ui-web";
import { Link2, Plus } from "lucide-react";
import Link from "next/link";
import { useListLinksQuery } from "@/features/links/api/links-api";
import { LINK_STATES } from "@/features/links/constants/links";
import { LINKS_COPY as COPY } from "@/features/links/constants/links-copy";
import { amountLabel, linkState } from "@/features/links/lib/links";
import type { Link as PaymentLink } from "@/features/links/types/links";
import { ListToolbar } from "@/shared/components/list-toolbar";
import { RowsSkeleton } from "@/shared/components/rows-skeleton";
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
      {link.livemode ? null : <Badge tone={TONES.warning}>{COPY.testMode}</Badge>}
    </span>
  );
}

export interface LinksTableProps {
  profileId: string;
}

// R-140: the owner sees each link's visits and paid count, not every unpaid invoice it made.
export function LinksTable({ profileId }: LinksTableProps) {
  const list = useListLinksQuery(profileId);
  const links = list.currentData ?? [];
  return (
    <section
      aria-labelledby="links-title"
      aria-busy={!list.currentData && !list.isError}
      className="flex flex-col gap-4"
    >
      {/* The header's breadcrumb names the page on desktop, so the heading and its action show only below that. */}
      <div className="flex items-center justify-between gap-3 lg:contents">
        <h1 id="links-title" className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">
          {COPY.title}
        </h1>
        <NewLinkLink size="sm" className="lg:hidden" />
      </div>
      <ListToolbar
        search={<p className="flex-1 text-sm text-muted">{COPY.intro}</p>}
        actions={<NewLinkLink className="max-lg:hidden" />}
      />

      {list.isError && !list.currentData ? (
        <div role="alert" className="flex flex-wrap items-center gap-4 text-sm text-muted">
          {COPY.failed}
          <Button size="sm" variant="secondary" onClick={() => void list.refetch()}>
            {COPY.retry}
          </Button>
        </div>
      ) : !list.currentData ? (
        <RowsSkeleton count={2} className="fw-panel" />
      ) : links.length === 0 ? (
        <EmptyState icon={Link2} title={COPY.empty} description={COPY.emptyBody} />
      ) : (
        <div className="fw-panel overflow-hidden">
          <div className="hidden overflow-x-auto xl:block">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className={TABLE_HEAD_CLASSES}>
                  <th scope="col" className="w-[36%]">
                    {COPY.columns.link}
                  </th>
                  <th scope="col">{COPY.columns.amount}</th>
                  <th scope="col">{COPY.columns.status}</th>
                  <th scope="col">{COPY.columns.activity}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {links.map((link) => (
                  <tr
                    key={link.linkId}
                    className={`relative transition-colors duration-[var(--fw-duration-fast)] ${TABLE_ROW_CLASSES} ${ROW_INTERACTIVE_CLASSES}`}
                  >
                    <td className="max-w-80">
                      <Link
                        href={linkHref(link)}
                        title={link.title}
                        className="block truncate font-medium text-ink outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus"
                      >
                        {link.title}
                      </Link>
                      <span className="block truncate font-mono text-xs text-muted">
                        /l/{link.slug}
                      </span>
                    </td>
                    <td className="text-ink">{amountLabel(link)}</td>
                    <td>
                      <StateBadge link={link} />
                    </td>
                    <td className="text-muted">{COPY.activity(link.visits, link.paid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-line xl:hidden">
            {links.map((link) => (
              <li key={link.linkId}>
                <Link
                  href={linkHref(link)}
                  className={`flex min-h-16 items-center gap-3 px-4 py-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus sm:px-5 ${ROW_INTERACTIVE_CLASSES}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{link.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {amountLabel(link)} · {COPY.activity(link.visits, link.paid)}
                    </span>
                  </span>
                  <StateBadge link={link} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
