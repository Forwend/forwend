/** The PDF's page in mm, as apps/backend/internal/document draws it. */
export const PAGE = {
  width: 210,
  height: 297,
  margin: 20,
  rowLine: 4.6,
  rowPad: 2.2,
  testnet: 14,
  tableHead: 8,
  footer: 8,
} as const;

// Noto Sans at 9.5 pt fits about this many characters on a line of the 87 mm description column.
const DESCRIPTION_CHARS = 52;

export function rowHeight(description: string): number {
  const lines = Math.max(1, Math.ceil(description.length / DESCRIPTION_CHARS));
  return lines * PAGE.rowLine + 2 * PAGE.rowPad;
}

const wrapped = (text: string, chars: number) =>
  text.split("\n").reduce((n, part) => n + Math.max(1, Math.ceil(part.length / chars)), 0);

/** Above the item table, in mm: title block (27), status box (26), parties, dates row (16), title. */
export function headHeight(parties: readonly (readonly string[])[], title: string): number {
  const lines = Math.max(
    0,
    ...parties.map((lines) => lines.reduce((n, l) => n + wrapped(l, 44), 0)),
  );
  return 27 + 26 + (lines ? 11.5 + lines * PAGE.rowLine : 0) + 16 + (title ? 7 : 0);
}

/** In mm: totals, then the note and the pay box when they show. */
export function tailHeight(totals: number, note: string, pay: number): number {
  return (
    4 +
    totals * 6 +
    (note ? 11 + wrapped(note, 96) * PAGE.rowLine : 0) +
    (pay ? 6 + Math.max(34, 16 + pay * PAGE.rowLine) : 0)
  );
}

/** As the PDF breaks pages: the closing block stays whole after the last row. */
export function documentPages(
  rows: readonly number[],
  head: number,
  tail: number,
  testnet: boolean,
): number[][] {
  const body = PAGE.height - 2 * PAGE.margin - PAGE.footer;
  const pages: number[][] = [[]];
  let room = body - head - (testnet ? PAGE.testnet : 0) - PAGE.tableHead;
  rows.forEach((height, i) => {
    const last = i === rows.length - 1;
    if (height + (last ? tail : 0) > room && pages.at(-1)?.length) {
      pages.push([]);
      room = body - PAGE.tableHead;
    }
    pages.at(-1)?.push(i);
    room -= height;
  });
  if (rows.length && tail > room) pages.push([]);
  return pages;
}

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "29 Oct 2026": the day before the month, so no reader swaps them. */
export function documentDate(day: string): string {
  return DAY.format(new Date(`${day}T00:00:00Z`));
}
