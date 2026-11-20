"use client";

import { EmptyState, Skeleton } from "@forwend/ui-web";
import { UserRound } from "lucide-react";
import { PaymentReminders } from "@/features/invoices/components/payment-reminders";
import { RepeatsMonthly } from "@/features/invoices/components/repeats-monthly";
import { SendToClient } from "@/features/invoices/components/send-to-client";
import { ORDER } from "@/features/invoices/constants/invoice-detail";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import type { Invoice } from "@/features/invoices/types/invoices";
import { LoadError } from "@/shared/components/load-error";
import { Party } from "@/shared/components/party";
import { PANEL_TITLE } from "@/shared/constants/panel";
import { countryName } from "@/shared/lib/countries";
import { shortDate } from "@/shared/lib/dates";

export interface InvoiceClientPanelProps {
  profileId: string;
  invoice: Invoice;
  mine: Invoice | null; // null until the owner's read is in
  clientFailed: boolean;
  onRetry: () => void;
  retrying: boolean;
  number: string;
  payLink: string | null;
  payable: boolean;
}

/** Who is billed, and what reaches them: the invoice email, reminders and the monthly repeat. */
export function InvoiceClientPanel({
  profileId,
  invoice,
  mine,
  clientFailed,
  onRetry,
  retrying,
  number,
  payLink,
  payable,
}: InvoiceClientPanelProps) {
  const client = mine?.client;
  const sends = mine?.sends ?? [];
  const reminders = mine?.reminders ?? null;
  const retainer = mine?.retainer ?? null;
  const lastSend = sends.at(-1);
  const sendNote = lastSend?.sentAt
    ? COPY.emailed(shortDate(lastSend.sentAt))
    : lastSend?.failedAt
      ? COPY.emailFailed
      : lastSend
        ? COPY.send.sending(client?.email ?? null)
        : null;
  return (
    <section aria-labelledby="invoice-client" className={`fw-panel ${ORDER.client}`}>
      <h2 id="invoice-client" className={PANEL_TITLE}>
        {COPY.client}
      </h2>
      {clientFailed ? (
        <LoadError message={COPY.clientFailed} onRetry={onRetry} retrying={retrying} />
      ) : !mine ? (
        <Skeleton className="m-5 h-16" />
      ) : client?.name || client?.email || client?.address || client?.country || client?.taxId ? (
        <Party
          lines={[
            client.name,
            client.email,
            client.address,
            countryName(client.country),
            client.taxId ? `${COPY.taxId} ${client.taxId}` : null,
          ]}
        />
      ) : (
        <EmptyState compact icon={UserRound} title={COPY.noClient} />
      )}
      {payLink && mine ? (
        <div className="flex flex-col items-start gap-2 border-t border-line px-4 py-3 sm:px-5">
          <SendToClient
            profileId={profileId}
            invoiceId={invoice.invoiceId}
            number={number}
            email={client?.email ?? null}
            sends={sends}
          />
          {sendNote ? <p className="text-xs text-muted">{sendNote}</p> : null}
        </div>
      ) : null}
      {(client?.email || reminders?.on) && reminders ? (
        <PaymentReminders
          profileId={profileId}
          invoiceId={invoice.invoiceId}
          reminders={reminders}
          hasDueDate={!!invoice.dueDate}
          payable={payable}
        />
      ) : null}
      {retainer ? (
        <RepeatsMonthly profileId={profileId} invoiceId={invoice.invoiceId} retainer={retainer} />
      ) : null}
    </section>
  );
}
