import { Skeleton } from "@forwend/ui-web";
import { ChevronRight, FileText } from "lucide-react";
import type { ReactNode } from "react";
import {
  AMOUNT_BODY,
  GRID,
  HEADER,
  HEADER_MORE,
  HEADER_TITLE,
  ICON,
  MAIN_COLUMN,
  ORDER,
  PHONE_ROW,
  SIDE_COLUMN,
  TILE,
  TITLE,
} from "@/features/invoices/constants/invoice-detail";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import { LineSkeleton } from "@/shared/components/rows-skeleton";
import { PANEL_TITLE } from "@/shared/constants/panel";

/** The page's shape while it loads, so nothing moves when the data comes. */
export function InvoiceDetailSkeleton({ back, request }: { back: ReactNode; request: boolean }) {
  const title = (text: string) => <p className={PANEL_TITLE}>{text}</p>;
  const rows = (count: number) =>
    Array.from({ length: count }, (_, i) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have nothing else to tell them apart
      <div key={i} className="flex items-baseline justify-between gap-4 px-4 py-3 sm:px-5">
        <LineSkeleton size="text-sm" className="w-20" />
        <LineSkeleton size="text-sm" className="w-28" />
      </div>
    ));
  const markers = (count: number) =>
    Array.from({ length: count }, (_, i) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: placeholder steps have nothing else to tell them apart
      <span key={i} className="flex min-w-0 flex-col gap-2">
        <span className="size-5 shrink-0 rounded-pill border border-line-strong" />
        <LineSkeleton size="text-sm" className="w-24 max-w-full" />
      </span>
    ));
  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <div className={HEADER}>
        {back}
        <div aria-hidden className={`${HEADER_MORE} flex gap-2`}>
          <Skeleton className="h-10 w-28 max-lg:hidden" />
          <Skeleton className="h-10 w-20 max-lg:hidden" />
          <Skeleton className="size-10" />
        </div>
        <div aria-hidden className={HEADER_TITLE}>
          <span className={TILE}>
            <FileText />
          </span>
          <div className="min-w-0 flex-1">
            <LineSkeleton size="text-sm lg:hidden" className="w-36" />
            <LineSkeleton size={TITLE} className="w-48 max-w-full" />
            <LineSkeleton size="mt-1 text-sm max-lg:hidden" className="w-56 max-w-full" />
          </div>
        </div>
      </div>
      <div aria-hidden className={GRID}>
        <div className={MAIN_COLUMN}>
          <div className="fw-panel overflow-hidden">
            <div className={AMOUNT_BODY}>
              <div className="flex min-w-0 flex-col items-start">
                <LineSkeleton size="text-sm" className="w-24" />
                <LineSkeleton size="mt-1 text-4xl sm:text-5xl" className="w-56 max-w-full" />
                <span className="mt-2 flex items-center gap-2">
                  <Skeleton className="size-6 rounded-pill" />
                  <LineSkeleton size="text-sm" className="w-28" />
                </span>
                <LineSkeleton size="mt-4 text-sm sm:text-base" className="w-60 max-w-full" />
              </div>
              <Skeleton className="h-32 w-full" />
            </div>
            <div className="grid auto-cols-fr grid-flow-col gap-4 border-t border-line px-6 py-5 max-lg:hidden">
              {markers(4)}
            </div>
            <p className={`${PHONE_ROW} text-ink`}>
              {COPY.viewPayment}
              <ChevronRight className={`${ICON} text-muted`} />
            </p>
          </div>
          <div className="fw-panel lg:hidden">
            {title(COPY.progressTitle)}
            <div className="flex flex-col gap-5 px-4 py-4 sm:px-5">{markers(4)}</div>
          </div>
          <div className={`fw-panel ${ORDER.items}`}>
            {title(COPY.items)}
            {rows(2)}
          </div>
          <div className={`fw-panel ${ORDER.history}`}>
            {title(COPY.history.title)}
            {rows(2)}
          </div>
        </div>
        <div className={SIDE_COLUMN}>
          {request ? null : (
            <div className={`fw-panel ${ORDER.client}`}>
              {title(COPY.client)}
              <div className="px-4 py-3 sm:px-5">
                <LineSkeleton size="text-sm" className="w-32" />
                <LineSkeleton size="text-sm" className="w-44" />
                <LineSkeleton size="text-sm" className="w-36" />
              </div>
            </div>
          )}
          <div className={`fw-panel ${ORDER.details}`}>
            {title(COPY.details)}
            {rows(4)}
          </div>
        </div>
      </div>
    </div>
  );
}
