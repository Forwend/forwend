import { describe, expect, it } from "vitest";
import { documentPages, rowHeight } from "@/features/invoices/lib/invoice-document";

describe("documentPages", () => {
  it("keeps a short invoice on one page", () => {
    expect(documentPages([rowHeight("Design")], 106, 40, false)).toEqual([[0]]);
  });
  it("continues many lines on later pages and keeps the closing block whole", () => {
    const rows = Array.from({ length: 100 }, () => rowHeight("x".repeat(80)));
    const pages = documentPages(rows, 106, 60, true);
    expect(pages.length).toBeGreaterThan(2);
    expect(pages.flat()).toEqual(rows.map((_, i) => i));
  });
  it("moves the last row with the closing block when they don't fit together", () => {
    const rows = Array.from({ length: 9 }, () => rowHeight("x".repeat(52)));
    expect(documentPages(rows, 106, 200, false)).toEqual([[0, 1, 2, 3, 4, 5, 6, 7], [8]]);
  });
});
