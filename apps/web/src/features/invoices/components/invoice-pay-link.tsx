"use client";

import {
  BUTTON_VARIANTS,
  Button,
  type ButtonStyleOptions,
  COPY_STATUS,
  cx,
  IconButton,
  iconButtonClasses,
  QrCode,
  RowButton,
  rowButtonClasses,
  Sheet,
  useCopy,
} from "@forwend/ui-web";
import { Check, ChevronRight, Copy, ExternalLink, QrCode as QrIcon, Share } from "lucide-react";
import { useState } from "react";
import { PHONE_ACTION_BAR } from "@/features/invoices/constants/invoices";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";

const ICON = "size-[var(--fw-icon-sm)]";
const ROW_ICON = "size-[var(--fw-icon-md)] shrink-0 text-muted";

export interface InvoicePayLinkProps {
  /** The pay link's token (D-86). */
  payToken: string;
}

// The app renders only in the browser, after sign-in. The page never prints the link: it is long, and the QR, Copy
// link and Share carry it.
const payLinkOf = (payToken: string) => `${window.location.origin}/pay/${payToken}`;
// An outlined icon button, beside the outlined Edit.
const OUTLINED = "border border-line bg-surface text-ink hover:bg-surface-2";

/** Desktop: the pay link's actions in the page header, Copy link first. */
export function InvoicePayLinkActions({ payToken }: InvoicePayLinkProps) {
  const link = payLinkOf(payToken);
  const [qr, setQr] = useState(false);
  return (
    <>
      <IconButton
        label={COPY.showQr}
        size="md"
        aria-haspopup="dialog"
        title={COPY.showQr}
        onClick={() => setQr(true)}
        className={OUTLINED}
      >
        <QrIcon aria-hidden className={ICON} />
      </IconButton>
      <a
        href={`${link}?preview=1`}
        target="_blank"
        rel="noopener noreferrer"
        title={COPY.openPayPage}
        className={cx(iconButtonClasses("md"), OUTLINED)}
      >
        <ExternalLink aria-hidden className={ICON} />
        <span className="sr-only">
          {COPY.openPayPage} {COPY.inNewTab}
        </span>
      </a>
      <CopyLink link={link} />
      <QrSheet link={link} open={qr} onOpenChange={setQr} />
    </>
  );
}

/** Phones: the pay link's actions as rows under the amount panel, with Copy link and Share in the bar at the
 * bottom. */
export function InvoicePayLinkPhone({ payToken }: InvoicePayLinkProps) {
  const link = payLinkOf(payToken);
  const [qr, setQr] = useState(false);
  return (
    <div className="col-span-full flex flex-col gap-2 lg:hidden">
      <ul className="fw-panel flex flex-col p-1.5">
        <li>
          <RowButton aria-haspopup="dialog" onClick={() => setQr(true)}>
            <QrIcon aria-hidden className={ROW_ICON} />
            <span className="min-w-0 flex-1">{COPY.showQr}</span>
            <ChevronRight aria-hidden className={`${ICON} shrink-0 text-muted`} />
          </RowButton>
        </li>
        <li>
          <a
            href={`${link}?preview=1`}
            target="_blank"
            rel="noopener noreferrer"
            className={rowButtonClasses()}
          >
            <ExternalLink aria-hidden className={ROW_ICON} />
            <span className="min-w-0 flex-1">
              {COPY.openPayPage}
              <span className="sr-only"> {COPY.inNewTab}</span>
            </span>
          </a>
        </li>
      </ul>
      <div className={PHONE_ACTION_BAR}>
        <CopyLink link={link} className="h-11 flex-1" />
        <ShareLink link={link} variant={BUTTON_VARIANTS.secondary} className="h-11" />
      </div>
      <QrSheet link={link} open={qr} onOpenChange={setQr} />
    </div>
  );
}

function QrSheet({
  link,
  open,
  onOpenChange,
}: {
  link: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={COPY.sendTitle}>
      <QrCode value={link} label={COPY.qrLabel} className="mx-auto w-full max-w-64" />
    </Sheet>
  );
}

function CopyLink({ link, className }: { link: string; className?: string }) {
  const [status, copy] = useCopy(link);
  const label =
    status === COPY_STATUS.copied
      ? COPY.copied
      : status === COPY_STATUS.failed
        ? COPY.copyFailed
        : COPY.copy;
  return (
    <>
      <Button onClick={() => void copy()} className={className}>
        {status === COPY_STATUS.copied ? (
          <Check aria-hidden className={ICON} />
        ) : (
          <Copy aria-hidden className={ICON} />
        )}
        {label}
      </Button>
      <span role="status" className="sr-only">
        {status === COPY_STATUS.idle ? "" : label}
      </span>
    </>
  );
}

// Only where the browser has a share sheet.
function ShareLink({
  link,
  ...style
}: { link: string } & ButtonStyleOptions & { className?: string }) {
  if (typeof navigator.share !== "function") return null;
  return (
    <Button
      {...style}
      // Closing the share sheet without sharing rejects too; there is nothing to report.
      onClick={() => void navigator.share({ url: link }).catch(() => {})}
    >
      <Share aria-hidden className={ICON} />
      {COPY.share}
    </Button>
  );
}
