// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { CHECKLIST_STEPS } from "@/features/onboarding/constants/onboarding";
import {
  afterOnboarding,
  checklistSteps,
  landingProfile,
  readDismissal,
  saveDismissal,
  visibleSteps,
} from "@/features/onboarding/lib/onboarding";
import type { ChecklistFacts, ChecklistStep } from "@/features/onboarding/types/onboarding";
import type { Profile } from "@/features/profiles/types/profile";

const nothing: ChecklistFacts = {
  passkeyLinked: false,
  hasBillingDetails: false,
  invoices: [],
  transactions: [],
};
const done = (steps: ReturnType<typeof checklistSteps>) =>
  Object.fromEntries((steps ?? []).map((s) => [s.id, s.done]));

describe("checklistSteps", () => {
  it("lists billing details only for a freelancer, and no checklist for a merchant", () => {
    expect(checklistSteps("freelancer", nothing)?.map((s) => s.id)).toEqual([
      "passkey",
      "billing_details",
      "first_invoice",
      "first_paid",
      "first_money",
    ]);
    expect(checklistSteps("personal", nothing)?.map((s) => s.id)).toEqual([
      "passkey",
      "first_invoice",
      "first_paid",
      "first_money",
    ]);
    expect(checklistSteps("merchant", nothing)).toBeNull();
  });

  it("marks nothing done for a new profile", () => {
    expect(Object.values(done(checklistSteps("freelancer", nothing)))).not.toContain(true);
  });

  it("reads each step from the data", () => {
    const steps = checklistSteps("freelancer", {
      passkeyLinked: true,
      hasBillingDetails: true,
      invoices: [{ paymentStatus: "open" }, { paymentStatus: "paid" }],
      transactions: [{ direction: "in", status: "confirmed" }],
    });
    expect(Object.values(done(steps))).toEqual([true, true, true, true, true]);
  });

  it("counts an invoice as paid only in full, and money as received only once final and incoming", () => {
    const steps = checklistSteps("personal", {
      ...nothing,
      invoices: [
        { paymentStatus: "partially_paid" },
        { paymentStatus: "expired_partially_paid" },
        { paymentStatus: "detected" },
      ],
      transactions: [
        { direction: "in", status: "detected" },
        { direction: "out", status: "confirmed" },
      ],
    });
    expect(done(steps)).toEqual({
      passkey: false,
      first_invoice: true,
      first_paid: false,
      first_money: false,
    });
  });
});

describe("visibleSteps", () => {
  const steps: ChecklistStep[] = [
    { id: CHECKLIST_STEPS.passkey, done: false },
    { id: CHECKLIST_STEPS.firstInvoice, done: true },
  ];
  it("leaves skipped steps out and hides when closed or when every other step is done", () => {
    expect(visibleSteps(steps, { closed: false, skipped: [] })).toEqual(steps);
    expect(visibleSteps(steps, { closed: true, skipped: [] })).toBeNull();
    expect(visibleSteps(steps, { closed: false, skipped: ["passkey"] })).toBeNull();
    expect(visibleSteps(steps, { closed: false, skipped: ["first_invoice"] })).toEqual([steps[0]]);
    expect(
      visibleSteps([{ id: CHECKLIST_STEPS.passkey, done: true }], { closed: false, skipped: [] }),
    ).toBeNull();
  });
});

describe("dismissal", () => {
  afterEach(() => localStorage.clear());
  it("is kept per profile and starts empty", () => {
    expect(readDismissal("p-1")).toEqual({ closed: false, skipped: [] });
    saveDismissal("p-1", { closed: false, skipped: ["passkey"] });
    expect(readDismissal("p-1")).toEqual({ closed: false, skipped: ["passkey"] });
    expect(readDismissal("p-2")).toEqual({ closed: false, skipped: [] });
    localStorage.setItem("forwend:checklist:p-3", "{broken");
    expect(readDismissal("p-3")).toEqual({ closed: false, skipped: [] });
  });
});

describe("landingProfile", () => {
  const profile = (profileId: string, kind: Profile["kind"]): Profile => ({
    profileId,
    kind,
    name: null,
    walletAddress: null,
    createdAt: "2026-10-11T00:00:00Z",
  });
  const personal = profile("p", "personal");
  it("opens the new freelancer, then the new merchant, else the personal profile", () => {
    const freelancer = profile("f", "freelancer");
    const merchant = profile("m", "merchant");
    expect(landingProfile([personal], [personal, merchant, freelancer])).toBe(freelancer);
    expect(landingProfile([personal], [personal, merchant])).toBe(merchant);
    expect(landingProfile([personal], [personal])).toBe(personal);
    // Profiles the user had before are not "made" by the choice.
    expect(landingProfile([personal, merchant], [personal, merchant])).toBe(personal);
  });
});

describe("afterOnboarding", () => {
  it("returns to the app page asked for, with its query", () => {
    expect(afterOnboarding("/app/invoices?status=paid")).toBe("/app/invoices?status=paid");
    expect(afterOnboarding("/app")).toBe("/app");
  });

  it("goes to the overview for anything that is not an app page: never another site", () => {
    for (const next of [
      null,
      "",
      "//evil.example",
      "https://evil.example/app",
      "/apple",
      "/app/onboarding",
      "/pay/0x1",
      "/app/../pay/x",
      "/app/..//evil.example/x",
      "/app\\..\\pay",
      "javascript:alert(1)",
      "http://[",
      "//[",
    ]) {
      expect(afterOnboarding(next)).toBe("/app");
    }
  });
});
