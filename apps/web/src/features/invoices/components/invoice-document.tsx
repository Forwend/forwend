import { LogoMark } from "@forwend/ui-web";
import type { CSSProperties, ReactNode } from "react";
import {
  documentPages,
  headHeight,
  PAGE,
  rowHeight,
  tailHeight,
} from "@/features/invoices/lib/invoice-document";

/** A length on the page in mm, scaled to the sheet's width. */
const mm = (n: number) => `calc(var(--mm) * ${n})`;
/** A font size in points: 1 pt is 0.3528 mm. */
const pt = (n: number) => mm(n * 0.3528);

export interface DocumentParty {
  name: string;
  lines: readonly string[];
}

export interface DocumentLine {
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
}

export interface InvoiceDocumentProps {
  /** "Invoice", or "Request" for a personal profile. */
  kind: string;
  /** The number once it has one; a new invoice shows what it will be called. */
  number: string;
  reference: string;
  testnet: boolean;
  status: { label: string; detail: string; figure: string; amount: string };
  from: DocumentParty | null;
  to: DocumentParty | null;
  facts: readonly (readonly [string, string])[];
  title: string;
  lines: readonly DocumentLine[];
  totals: readonly (readonly [string, string])[];
  note: string;
  pay: readonly string[];
  /** Read aloud in place of the drawing. */
  label: string;
}

const TESTNET = "Test mode: testnet tokens have no value";

/** The invoice as its PDF draws it: A4 pages with the same blocks, sizes and page breaks, scaled to fit. */
export function InvoiceDocument(props: InvoiceDocumentProps) {
  const { kind, number, lines, testnet, label } = props;
  const pages = documentPages(
    lines.map((line) => rowHeight(line.description)),
    headHeight(
      [props.from, props.to].map((party) => (party ? [party.name, ...party.lines] : [])),
      props.title,
    ),
    tailHeight(props.totals.length, props.note, props.pay.length),
    testnet,
  );
  return (
    <figure
      aria-label={label}
      className="flex flex-col gap-4 font-[family-name:var(--fw-font-document-loaded,var(--fw-font-sans))]"
    >
      {pages.map((rows, i) => (
        <Page
          // biome-ignore lint/suspicious/noArrayIndexKey: pages are positions, not records
          key={i}
          footer={`${kind} ${number}${testnet ? " · Test mode" : ""} · Page ${i + 1} of ${pages.length}`}
        >
          {i === 0 ? <Head {...props} /> : null}
          {rows.length ? <Items {...props} rows={rows} first={i === 0} /> : null}
          {i === pages.length - 1 ? <Tail {...props} /> : null}
        </Page>
      ))}
    </figure>
  );
}

function Page({ footer, children }: { footer: string; children: ReactNode }) {
  return (
    // White paper in either theme, as the file prints.
    <div
      data-theme="light"
      className="@container relative aspect-[210/297] w-full overflow-hidden rounded-sm bg-surface text-ink shadow-md ring-1 ring-line"
    >
      <div
        className="absolute inset-0 flex flex-col"
        style={{ "--mm": "calc(100cqw / 210)", padding: mm(PAGE.margin) } as CSSProperties}
      >
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        <p className="text-subtle" style={{ fontSize: pt(7.5) }}>
          {footer}
        </p>
      </div>
    </div>
  );
}

function Head({ kind, number, reference, testnet, status, from, to, facts }: InvoiceDocumentProps) {
  return (
    <>
      <div className="flex items-start justify-between">
        {/* As the PDF draws it: the 7.5mm mark, then the name 10mm from the margin. */}
        <span className="flex items-center font-bold" style={{ fontSize: pt(13), gap: mm(2.5) }}>
          <span style={{ width: mm(7.5), height: mm(7.5), marginTop: mm(0.5) }}>
            <LogoMark className="size-full" />
          </span>
          Forwend
        </span>
        <span className="flex flex-col items-end text-right">
          <span className="font-bold leading-none" style={{ fontSize: pt(22) }}>
            {kind}
          </span>
          <span style={{ fontSize: pt(10), marginTop: mm(1.5) }}>{number}</span>
          {reference ? (
            <span className="text-muted" style={{ fontSize: pt(9) }}>
              Reference {reference}
            </span>
          ) : null}
        </span>
      </div>
      <hr className="border-line" style={{ marginTop: mm(5), marginBottom: mm(7) }} />
      {testnet ? (
        <p
          className="flex items-center bg-surface-2"
          style={{ height: mm(9), paddingInline: mm(5), marginBottom: mm(5), fontSize: pt(9) }}
        >
          <span className="font-bold" style={{ width: mm(18), fontSize: pt(8) }}>
            Testnet
          </span>
          {TESTNET}
        </p>
      ) : null}
      <div
        className="flex items-start justify-between border border-line"
        style={{ borderRadius: mm(2.5), padding: mm(5), gap: mm(6) }}
      >
        <span className="flex min-w-0 gap-[calc(var(--mm)*2.6)]">
          <span
            aria-hidden
            className="shrink-0 border border-brand-edge bg-brand"
            style={{ width: mm(2.4), height: mm(2.4), marginTop: mm(1.6) }}
          />
          <span className="flex min-w-0 flex-col">
            <span className="font-bold" style={{ fontSize: pt(12) }}>
              {status.label}
            </span>
            <span className="text-muted" style={{ fontSize: pt(9.5) }}>
              {status.detail}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span className="font-bold text-subtle" style={{ fontSize: pt(7.5) }}>
            {status.figure}
          </span>
          <span className="font-bold tabular-nums" style={{ fontSize: pt(17) }}>
            {status.amount}
          </span>
        </span>
      </div>
      <div className="grid grid-cols-2" style={{ marginTop: mm(6), columnGap: mm(5) }}>
        {from ? <Party heading="From" party={from} /> : <span />}
        {to ? <Party heading="Billed to" party={to} /> : null}
      </div>
      <dl className="grid grid-cols-4" style={{ marginTop: mm(6) }}>
        {facts
          .filter(([, value]) => value)
          .map(([term, value]) => (
            <div key={term}>
              <dt className="text-subtle" style={{ fontSize: pt(8) }}>
                {term}
              </dt>
              <dd style={{ fontSize: pt(9.5) }}>{value}</dd>
            </div>
          ))}
      </dl>
    </>
  );
}

function Party({ heading, party }: { heading: string; party: DocumentParty }) {
  return (
    <div className="min-w-0 [overflow-wrap:anywhere]">
      <p className="font-bold text-subtle" style={{ fontSize: pt(7.5) }}>
        {heading}
      </p>
      <p className="font-bold" style={{ fontSize: pt(10), marginTop: mm(0.5) }}>
        {party.name}
      </p>
      {party.lines.filter(Boolean).map((line) => (
        <p key={line} className="whitespace-pre-line text-muted" style={{ fontSize: pt(9.5) }}>
          {line}
        </p>
      ))}
    </div>
  );
}

const COLUMNS = "grid grid-cols-[87fr_19fr_32fr_32fr] gap-x-[calc(var(--mm)*4)]";

function Items({
  title,
  lines,
  rows,
  first,
}: InvoiceDocumentProps & { rows: readonly number[]; first: boolean }) {
  return (
    <div style={{ marginTop: first ? mm(8) : 0 }}>
      {first && title ? (
        <p className="font-bold" style={{ fontSize: pt(11), marginBottom: mm(2) }}>
          {title}
        </p>
      ) : null}
      <div
        className={`${COLUMNS} border-b border-line font-bold text-subtle`}
        style={{ fontSize: pt(7.5), paddingBottom: mm(1.5) }}
      >
        <span>Description</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Unit price</span>
        <span className="text-right">Amount</span>
      </div>
      {rows.map((i) => {
        const line = lines[i];
        if (!line) return null;
        return (
          <div
            key={i}
            className={`${COLUMNS} border-b border-line/50 tabular-nums`}
            style={{
              fontSize: pt(9.5),
              paddingBlock: mm(PAGE.rowPad),
              lineHeight: mm(PAGE.rowLine),
            }}
          >
            <span className="[overflow-wrap:anywhere]">{line.description}</span>
            <span className="text-right">{line.quantity}</span>
            <span className="text-right">{line.unitPrice}</span>
            <span className="text-right">{line.amount}</span>
          </div>
        );
      })}
    </div>
  );
}

function Tail({ kind, totals, note, pay }: InvoiceDocumentProps) {
  return (
    <>
      <dl className="ml-auto flex w-1/2 flex-col" style={{ marginTop: mm(2), fontSize: pt(9.5) }}>
        {totals.map(([term, value], i) => (
          <div
            key={term}
            className={`flex justify-between ${i === totals.length - 1 ? "font-bold" : "text-muted"}`}
            style={{
              paddingBlock: mm(1),
              fontSize: i === totals.length - 1 ? pt(10.5) : undefined,
            }}
          >
            <dt>{term}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {note ? (
        <div style={{ marginTop: mm(6) }}>
          <p className="font-bold text-subtle" style={{ fontSize: pt(7.5) }}>
            Note
          </p>
          <p
            className="line-clamp-4 whitespace-pre-line text-muted [overflow-wrap:anywhere]"
            style={{ fontSize: pt(9.5) }}
          >
            {note}
          </p>
        </div>
      ) : null}
      {pay.length ? (
        <div
          className="flex items-start border border-line"
          style={{ marginTop: mm(6), borderRadius: mm(2.5), padding: mm(5), gap: mm(6) }}
        >
          {/* The file prints the pay link's QR code here; the preview has no link yet. */}
          <span
            aria-hidden
            className="shrink-0 border border-dashed border-line-strong"
            style={{ width: mm(24), height: mm(24) }}
          />
          <span className="flex min-w-0 flex-col [overflow-wrap:anywhere]">
            <span className="font-bold" style={{ fontSize: pt(11) }}>
              Pay this {kind.toLowerCase()}
            </span>
            {pay.map((line) => (
              <span key={line} style={{ fontSize: pt(9.5) }}>
                {line}
              </span>
            ))}
          </span>
        </div>
      ) : null}
    </>
  );
}
