import { PAYMENT_STATUS } from "@forwend/ui-web";
import { describe, expect, it } from "vitest";
import { canStillBePaid, daysUntilDue } from "@/features/invoices/lib/invoice-list";

const now = new Date("2026-11-09T14:10:00Z");
const open = { closesAt: "2027-01-19T14:10:00Z" };

describe("invoice list rows", () => {
  it("counts whole UTC days to the due date: 0 today, negative once late", () => {
    expect(daysUntilDue("2026-11-20", now)).toBe(11);
    expect(daysUntilDue("2026-11-09", now)).toBe(0);
    expect(daysUntilDue("2026-11-06", now)).toBe(-3);
    // Late evening in UTC is still the same UTC day.
    expect(daysUntilDue("2026-11-10", new Date("2026-11-09T23:59:00Z"))).toBe(1);
  });

  it("offers the pay link only while the invoice can be paid and its checkout is open", () => {
    expect(canStillBePaid(open, PAYMENT_STATUS.partiallyPaid, now)).toBe(true);
    expect(canStillBePaid(open, PAYMENT_STATUS.paid, now)).toBe(false);
    expect(canStillBePaid(open, PAYMENT_STATUS.expired, now)).toBe(false);
    // Sent on time and still confirming ten minutes after the close: the status stays payable for a while.
    expect(
      canStillBePaid({ closesAt: "2026-11-09T14:00:00Z" }, PAYMENT_STATUS.confirming, now),
    ).toBe(false);
  });
});
