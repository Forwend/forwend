"use client";

import { Button, IconButton, SegmentedControl } from "@forwend/ui-web";
import { Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  InvoiceDocument,
  type InvoiceDocumentProps,
} from "@/features/invoices/components/invoice-document";
import { NEW_INVOICE_COPY } from "@/features/invoices/constants/invoices-copy";

export interface NewInvoicePreviewProps {
  document: InvoiceDocumentProps;
  /** Who the payer sees asking, the amount and how it can be paid. */
  payer: { name: string; amount: string; network: string };
  /** The email the client gets when it is sent. */
  email: { subject: string; lead: string; details: readonly (readonly [string, string])[] };
}

const COPY = {
  ...NEW_INVOICE_COPY.preview,
  invoice: "Invoice",
  payer: "Payer page",
  email: "Email",
  amount: "Amount",
  payWith: "Pay with",
  showAddress: "Show address",
  sample: "Preview: the address shows once it is created.",
  viewAndPay: "View and pay",
  emailNote: "Sent from Forwend. Replies go to you.",
} as const;

const VIEWS = { invoice: "invoice", payer: "payer", email: "email" } as const;
type View = (typeof VIEWS)[keyof typeof VIEWS];
// Each view's width at 100%, in CSS pixels: an A4 page, the pay page's column, the email's card.
const WIDTHS: Record<View, number> = { invoice: 794, payer: 420, email: 600 };
const A4 = 297 / 210;
const ZOOMS = [50, 75, 100, 125] as const;
const FIT = "fit";
// The canvas's padding on both sides, which a fitted page leaves free.
const GAP = 32;

/** The three things the client will see, drawn from what the form holds now; switching keeps every typed value.
 * Fit shows a whole page; the levels zoom in to read it. */
export function NewInvoicePreview({ document, payer, email }: NewInvoicePreviewProps) {
  const [view, setView] = useState<View>(VIEWS.invoice);
  const [zoom, setZoom] = useState<typeof FIT | (typeof ZOOMS)[number]>(FIT);
  const canvas = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = canvas.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() =>
      setRoom({ width: element.clientWidth, height: element.clientHeight }),
    );
    watch.observe(element);
    return () => watch.disconnect();
  }, []);
  const width = WIDTHS[view];
  // A page fits by both sides; the pay page and the email are as long as their content, so they fit by width.
  const fitted =
    room.width === 0
      ? 0.5
      : Math.min(
          1.25,
          (room.width - GAP) / width,
          view === VIEWS.invoice ? (room.height - GAP) / (width * A4) : 1,
        );
  const scale = zoom === FIT ? fitted : zoom / 100;
  const percent = Math.round(scale * 100);
  const smaller = [...ZOOMS].reverse().find((level) => level < percent);
  const larger = ZOOMS.find((level) => level > percent);
  // Read from the last drawing: a new page shows in the count one keystroke later.
  const pages = Math.max(1, canvas.current?.querySelectorAll("figure > div").length ?? 1);
  return (
    <section
      aria-label={COPY.title}
      className="fw-panel flex h-full min-h-0 flex-col overflow-hidden"
    >
      <div className="flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-line p-2">
        <SegmentedControl
          size="sm"
          label={COPY.show}
          value={view}
          onValueChange={setView}
          options={[
            { value: VIEWS.invoice, label: COPY.invoice },
            { value: VIEWS.payer, label: COPY.payer },
            { value: VIEWS.email, label: COPY.email },
          ]}
        />
        <div className="ml-auto flex items-center gap-1">
          <IconButton
            size="sm"
            label={COPY.zoomOut}
            disabled={!smaller}
            onClick={() => smaller && setZoom(smaller)}
          >
            <ZoomOut aria-hidden className="size-[var(--fw-icon-sm)]" />
          </IconButton>
          <span className="min-w-10 text-center text-xs text-muted tabular-nums">
            {COPY.percent(percent)}
          </span>
          <IconButton
            size="sm"
            label={COPY.zoomIn}
            disabled={!larger}
            onClick={() => larger && setZoom(larger)}
          >
            <ZoomIn aria-hidden className="size-[var(--fw-icon-sm)]" />
          </IconButton>
          <Button
            size="sm"
            variant={zoom === FIT ? "secondary" : "ghost"}
            aria-pressed={zoom === FIT}
            onClick={() => setZoom(FIT)}
          >
            <Maximize aria-hidden className="size-[var(--fw-icon-sm)]" />
            {COPY.fit}
          </Button>
        </div>
      </div>
      <div
        ref={canvas}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users scroll a page zoomed past the pane
        tabIndex={0}
        className="flex min-h-0 flex-1 overflow-auto overscroll-contain bg-sunken p-4 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      >
        {/* Sized by zoom, not a transform: the text stays sharp and the canvas scrolls by the real size. */}
        <div className="m-auto shrink-0" style={{ width, zoom: scale }}>
          {view === VIEWS.invoice ? (
            <InvoiceDocument {...document} />
          ) : view === VIEWS.payer ? (
            <PayerPage {...payer} document={document} />
          ) : (
            <EmailPage {...email} amount={payer.amount} />
          )}
        </div>
      </div>
      {view === VIEWS.invoice ? (
        <p className="flex justify-between gap-3 border-t border-line px-3 py-2 text-xs text-muted">
          <span>{COPY.pages(pages)}</span>
          <span>{COPY.live}</span>
        </p>
      ) : null}
    </section>
  );
}

/** The pay page's first screen, in its layout: who asks, the amount, then the pay box. */
function PayerPage({
  name,
  amount,
  network,
  document,
}: NewInvoicePreviewProps["payer"] & { document: InvoiceDocumentProps }) {
  return (
    <div className="flex flex-col gap-5 rounded-lg border border-line bg-bg p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-md border border-line bg-surface text-sm font-semibold">
          {(name || "?").charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-semibold text-ink">{name || "—"}</span>
          <span className="block text-sm text-muted">
            {document.kind} {document.number}
          </span>
        </span>
      </div>
      <div>
        <p className="text-sm text-muted">{COPY.amount}</p>
        <p className="text-3xl font-medium tracking-tight text-ink tabular-nums">{amount}</p>
        <p className="text-sm text-muted">{network}</p>
      </div>
      {document.title ? <p className="text-sm font-medium text-ink">{document.title}</p> : null}
      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
        <p className="text-sm text-muted">{COPY.payWith}</p>
        <p className="text-sm font-medium text-ink">{network}</p>
        <span className="grid h-12 place-items-center rounded-md bg-brand text-sm font-medium text-on-brand opacity-60">
          {COPY.showAddress}
        </span>
        <p className="text-xs text-muted">{COPY.sample}</p>
      </div>
    </div>
  );
}

/** The invoice email's layout (apps/backend/internal/notify), at a phone's width when the panel is narrow. */
function EmailPage({
  subject,
  lead,
  details,
  amount,
}: NewInvoicePreviewProps["email"] & { amount: string }) {
  return (
    <div data-theme="light" className="rounded-lg bg-surface-2 p-4 text-ink sm:p-6">
      <p className="mb-3 truncate text-sm text-muted">{subject}</p>
      <div className="mx-auto max-w-[37.5rem] rounded-lg border border-line bg-surface p-6 sm:p-8">
        <p className="text-lg font-semibold">Forwend</p>
        <h3 className="mt-6 text-xl font-semibold tracking-tight [overflow-wrap:anywhere]">
          {subject}
        </h3>
        <p className="mt-2 text-3xl font-medium tracking-tight tabular-nums">{amount}</p>
        <p className="mt-4 text-sm text-muted [overflow-wrap:anywhere]">{lead}</p>
        <dl className="mt-5 text-sm">
          {details.map(([term, value]) => (
            <div key={term} className="flex justify-between gap-4 border-t border-line py-2.5">
              <dt className="text-muted">{term}</dt>
              <dd className="text-right [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
        <span className="mt-6 inline-flex h-11 items-center rounded-md border border-brand-edge bg-brand px-5 text-sm font-medium text-on-brand">
          {COPY.viewAndPay}
        </span>
      </div>
      <p className="mx-auto mt-4 max-w-[37.5rem] text-xs text-muted">{COPY.emailNote}</p>
    </div>
  );
}
