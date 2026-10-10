"use client";

import { Button, buttonClasses, Sheet, Skeleton } from "@forwend/ui-web";
import { Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { InvoiceAmount } from "@/features/invoices/invoice-amount";
import { ShareLink } from "@/features/invoices/invoice-detail";
import type { Invoice, InvoiceToken } from "@/features/invoices/invoices";
import { NEW_REQUEST_COPY as COPY, INVOICES_COPY } from "@/features/invoices/invoices-copy";
import { NewInvoiceForm } from "@/features/invoices/new-invoice-form";
import { APP_ROUTES } from "@/shared/config/routes";

// Request money (R-49), in a sheet over any page of a personal profile: the form, then the pay link to send. The
// content mounts only while open, so each opening starts a new request.
export function RequestSheet({
  open,
  onOpenChange,
  profileId,
  senderName,
  tokens,
  failed,
  onRetry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileId: string;
  /** The profile's name, the form's first guess at the name the payer sees. */
  senderName: string;
  tokens: readonly InvoiceToken[] | null;
  failed: boolean;
  onRetry: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={COPY.title}>
      {!open ? null : !tokens && failed ? (
        <div role="alert" className="flex flex-col items-start gap-3 text-sm text-muted">
          {COPY.tokensFailed}
          <Button size="sm" variant="secondary" onClick={onRetry}>
            {INVOICES_COPY.retry}
          </Button>
        </div>
      ) : !tokens ? (
        <Skeleton className="h-96" />
      ) : tokens.length === 0 ? (
        <p className="text-sm text-muted">{COPY.noTokens}</p>
      ) : (
        <Request
          profileId={profileId}
          senderName={senderName}
          tokens={tokens}
          onClose={() => onOpenChange(false)}
        />
      )}
    </Sheet>
  );
}

function Request({
  profileId,
  senderName,
  tokens,
  onClose,
}: {
  profileId: string;
  senderName: string;
  tokens: readonly InvoiceToken[];
  onClose: () => void;
}) {
  const [created, setCreated] = useState<Invoice | null>(null);
  const done = useRef<HTMLDivElement>(null);
  // The form is gone: focus the outcome, so a screen reader reads it and Tab reaches the link next.
  useEffect(() => {
    if (created) done.current?.focus();
  }, [created]);
  if (!created) {
    return (
      <NewInvoiceForm
        profileId={profileId}
        tokens={tokens}
        request={{ senderName, onCreated: setCreated }}
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div ref={done} tabIndex={-1} className="flex flex-col gap-1 outline-none">
        <p className="flex items-center gap-2 text-sm text-muted">
          <Check aria-hidden className="size-[var(--fw-icon-sm)] shrink-0 text-success" />
          {COPY.created}
        </p>
        <p className="text-2xl font-semibold tracking-tight text-ink">
          <InvoiceAmount invoice={created} tokens={tokens} />
        </p>
      </div>
      <ShareLink invoiceId={created.invoiceId} hint={COPY.shareHint} />
      <Link
        href={`${APP_ROUTES.invoices}/${created.invoiceId}`}
        onClick={onClose}
        className={`${buttonClasses({ variant: "secondary" })} self-start`}
      >
        {COPY.view}
      </Link>
    </div>
  );
}
