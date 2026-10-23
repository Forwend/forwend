import { describe, expect, it } from "vitest";
import { JOBS_COPY, QUOTE_COPY } from "@/features/jobs/constants/jobs-copy";
import {
  apiCents,
  centsText,
  dueDays,
  invalidJobField,
  jobRecord,
  usdCents,
} from "@/features/jobs/lib/jobs";

describe("job amounts", () => {
  // R-100.
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

describe("job record", () => {
  // R-104: acceptance and its deposit share a time.
  it("lists the events oldest first, acceptance before the invoice it made", () => {
    const payment = (position: number, more: object) => ({
      position,
      title: `Step ${position}`,
      amountUsd: "100.00",
      dueDays: 7,
      onAccept: position === 1,
      invoiceId: null,
      payToken: null,
      number: null,
      status: null,
      doneAt: null,
      deliveryLink: null,
      invoicedAt: null,
      paidAt: null,
      proposedAt: null,
      acceptedName: null,
      acceptedAt: null,
      ...more,
    });
    const job = {
      title: "Logo",
      scope: null,
      issuer: { name: "Alice", address: "x", country: "DE", taxId: null, email: "a@x.example" },
      totalUsd: "200.00",
      acceptedName: "Jane Doe",
      acceptedAt: "2026-10-02T10:00:00Z",
      createdAt: "2026-10-01T10:00:00Z",
      payments: [
        payment(1, {
          number: 7,
          invoicedAt: "2026-10-02T10:00:00Z",
          paidAt: "2026-10-03T09:00:00Z",
        }),
        payment(2, {
          number: 9,
          doneAt: "2026-10-05T12:00:00Z",
          deliveryLink: "https://drive.example",
          invoicedAt: "2026-10-05T12:00:00Z",
        }),
      ],
    };
    expect(jobRecord(job).map((e) => `${e.kind}${e.payment?.position ?? ""}`)).toEqual([
      "created",
      "accepted",
      "invoiced1",
      "paid1",
      "done2",
      "invoiced2",
    ]);
  });

  // R-106.
  it("lists a change's proposal and acceptance in time order", () => {
    const base = {
      dueDays: 7,
      onAccept: false,
      invoiceId: null,
      payToken: null,
      number: null,
      status: null,
      doneAt: null,
      deliveryLink: null,
      invoicedAt: null,
      paidAt: null,
      acceptedName: null,
      acceptedAt: null,
      proposedAt: null,
    };
    const job = {
      title: "Logo",
      scope: null,
      issuer: { name: "Alice", address: "x", country: "DE", taxId: null, email: "a@x.example" },
      totalUsd: "250.00",
      acceptedName: "Jane Doe",
      acceptedAt: "2026-10-02T10:00:00Z",
      createdAt: "2026-10-01T10:00:00Z",
      payments: [
        { ...base, position: 1, title: "Logo", amountUsd: "100.00" },
        {
          ...base,
          position: 2,
          title: "Extra page",
          amountUsd: "150.00",
          proposedAt: "2026-10-04T09:00:00.123456Z",
          acceptedName: "Jane Doe",
          acceptedAt: "2026-10-05T09:00:00Z",
          number: 3,
          invoicedAt: "2026-10-06T09:00:00Z",
          doneAt: "2026-10-06T09:00:00Z",
        },
      ],
    };
    expect(jobRecord(job).map((e) => `${e.kind}${e.payment?.position ?? ""}`)).toEqual([
      "created",
      "accepted",
      "proposed2",
      "changeAccepted2",
      "done2",
      "invoiced2",
    ]);
  });
});

describe("job copy", () => {
  it("says when a payment is due, with one day singular", () => {
    for (const due of [JOBS_COPY.detail.dueDays, QUOTE_COPY.dueDays]) {
      expect([0, 1, 7].map(due)).toEqual([
        "due the day it is invoiced",
        "due 1 day after",
        "due 7 days after",
      ]);
    }
  });
});
