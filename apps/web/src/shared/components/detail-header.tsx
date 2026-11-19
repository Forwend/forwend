import { Skeleton } from "@forwend/ui-web";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode, Ref } from "react";
import { LineSkeleton } from "@/shared/components/rows-skeleton";

export interface DetailHeaderProps {
  back?: { href: string; label: string };
  title: ReactNode;
  badges?: ReactNode;
  meta?: ReactNode;
  icon?: ReactNode;
  figure?: { label: string; value: ReactNode };
  actions?: ReactNode;
  titleRef?: Ref<HTMLHeadingElement>;
}

export const RECORD_COLUMNS =
  "grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]";

/** The top of every record page, in the same order everywhere. */
export function DetailHeader({
  back,
  title,
  badges,
  meta,
  icon,
  figure,
  actions,
  titleRef,
}: DetailHeaderProps) {
  return (
    <header className="flex flex-col gap-4">
      {back ? <BackLink href={back.href} label={back.label} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 items-start gap-3">
          {icon ? (
            <span className="grid size-11 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-muted [&_svg]:size-[var(--fw-icon-md)]">
              {icon}
            </span>
          ) : null}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1
                ref={titleRef}
                tabIndex={titleRef ? -1 : undefined}
                className="break-words text-xl font-semibold tracking-tight text-ink outline-none"
              >
                {title}
              </h1>
              {badges}
            </div>
            {meta ? <p className="mt-1 text-sm text-muted">{meta}</p> : null}
          </div>
        </div>
        {figure || actions ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            {figure ? (
              <p className="flex items-baseline gap-2">
                <span className="text-sm text-muted">{figure.label}</span>
                <span className="text-2xl font-medium tracking-tight text-ink tabular-nums">
                  {figure.value}
                </span>
              </p>
            ) : null}
            {figure && actions ? (
              <span aria-hidden className="hidden h-8 w-px bg-line sm:block" />
            ) : null}
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}

/** The header while its record loads, each part in place so the page below stays put; the back link works. */
export function DetailHeaderSkeleton({
  back,
  icon,
  meta = <LineSkeleton className="w-64 max-w-full" />,
  figure,
  actions = <Skeleton className="h-10 w-72 max-w-full" />,
}: Pick<DetailHeaderProps, "back" | "icon" | "meta" | "actions"> & { figure?: string }) {
  return (
    <div className="flex flex-col gap-4">
      {back ? <BackLink href={back.href} label={back.label} /> : null}
      <div aria-hidden>
        <DetailHeader
          icon={icon}
          title={<LineSkeleton className="w-48 max-w-full" />}
          meta={meta}
          figure={
            figure
              ? {
                  label: figure,
                  value: (
                    <span className="inline-block w-24 align-top">
                      <LineSkeleton className="w-full" />
                    </span>
                  ),
                }
              : undefined
          }
          actions={actions}
        />
      </div>
    </div>
  );
}

/** A 44px target: on phones this is the only way back. */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="-ml-1 inline-flex h-11 items-center gap-1 self-start rounded-sm px-1 text-sm text-muted hover:text-ink lg:hidden"
    >
      <ChevronLeft aria-hidden className="size-[var(--fw-icon-sm)]" />
      {label}
    </Link>
  );
}
