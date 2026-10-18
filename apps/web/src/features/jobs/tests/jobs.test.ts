import { describe, expect, it } from "vitest";
import { apiCents, centsText, dueDays, invalidJobField, usdCents } from "@/features/jobs/lib/jobs";

describe("job amounts", () => {
  // R-100: the API takes at most 2 decimals and 10 whole digits; anything else is named on the field, never rounded.
  it("reads typed USD as exact cents, refusing what the API refuses", () => {
    expect(usdCents("300")).toBe(30000n);
    expect(usdCents(" 700.5 ")).toBe(70050n);
    expect(usdCents("0.01")).toBe(1n);
    expect(usdCents("9999999999.99")).toBe(999999999999n);
    for (const bad of ["", "0", "0.00", "1.234", "1,50", "-5", "12345678901", ".5", "1e3"]) {
      expect(usdCents(bad)).toBeNull();
    }
    expect(centsText(30005n)).toBe("300.05");
    expect(apiCents("1000.50")).toBe(100050n);
  });

  it("reads days to pay as whole days up to the API's 90", () => {
    expect(dueDays("0")).toBe(0);
    expect(dueDays("90")).toBe(90);
    for (const bad of ["91", "-1", "7.5", "", "x"]) expect(dueDays(bad)).toBeNull();
  });

  it("names the field the API refused", () => {
    expect(invalidJobField("invalid job request: client.email must be an email address")).toBe(
      "client.email",
    );
    expect(invalidJobField("invalid job request: payments need dueDays from 0 to 90")).toBe(
      "payments",
    );
    expect(invalidJobField("invalid job request: a profile has at most 1000 jobs")).toBeNull();
  });
});
