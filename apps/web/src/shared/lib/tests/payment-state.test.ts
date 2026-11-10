import { describe, expect, it } from "vitest";
import { PAYMENT_STATE_FILTERS } from "@/shared/constants/payment-state";
import { narrowedBy } from "@/shared/lib/payment-state";

describe("narrowedBy", () => {
  it("says what a list with no rows was searched and filtered by, as one sentence", () => {
    expect(narrowedBy("mara", PAYMENT_STATE_FILTERS.paid)).toBe("Search “mara”, status Paid.");
    expect(narrowedBy(undefined, PAYMENT_STATE_FILTERS.waiting, "source Invoice", null)).toBe(
      "Status Waiting for payment, source Invoice.",
    );
    expect(narrowedBy(undefined, PAYMENT_STATE_FILTERS.all)).toBeUndefined();
  });
});
