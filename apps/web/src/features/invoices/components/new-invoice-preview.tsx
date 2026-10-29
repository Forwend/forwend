import { Tabs } from "@forwend/ui-web";
import {
  InvoiceDocument,
  type InvoiceDocumentProps,
} from "@/features/invoices/components/invoice-document";

export interface NewInvoicePreviewProps {
  document: InvoiceDocumentProps;
  /** Who the payer sees asking, the amount and how it can be paid. */
  payer: { name: string; amount: string; network: string };
  /** The email the client gets when it is sent. */
  email: { subject: string; lead: string; details: readonly (readonly [string, string])[] };
}

const COPY = {
  label: "Preview",
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

/** The three things the client will see, drawn from what the form holds now; switching keeps every typed value. */
export function NewInvoicePreview({ document, payer, email }: NewInvoicePreviewProps) {
  return (
    <Tabs
      label={COPY.label}
      items={[
        { value: "invoice", label: COPY.invoice, content: <InvoiceDocument {...document} /> },
        {
          value: "payer",
          label: COPY.payer,
          content: <PayerPage {...payer} document={document} />,
        },
        {
          value: "email",
          label: COPY.email,
          content: <EmailPage {...email} amount={payer.amount} />,
        },
      ]}
    />
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
