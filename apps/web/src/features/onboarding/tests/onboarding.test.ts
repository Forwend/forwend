// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  ONBOARDING_CHOICES as C,
  ONBOARDING_STEPS as S,
} from "@/features/onboarding/constants/onboarding";
import {
  afterOnboarding,
  newKinds,
  onboardingSteps,
  rememberReturnPage,
  takeReturnPage,
} from "@/features/onboarding/lib/onboarding";

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

describe("onboardingSteps (R-50)", () => {
  it("adds one details step per new profile, and one merchant for both business uses", () => {
    expect(newKinds([C.buildIntegration, C.acceptBusinessPayments, C.getPaidByClients])).toEqual([
      "freelancer",
      "merchant",
    ]);
    expect(onboardingSteps([C.getPaidByClients, C.buildIntegration], false)).toEqual([
      S.use,
      S.freelancerDetails,
      S.merchantDetails,
      S.tokens,
      S.passkey,
      S.ready,
    ]);
  });

  it("asks no details for the personal profile and no passkey once one is linked", () => {
    expect(onboardingSteps([C.receiveAndSend], true)).toEqual([S.use, S.tokens, S.ready]);
  });
});

describe("the page asked for", () => {
  it("waits in the tab once, and never leads off the app", () => {
    rememberReturnPage("/app/links?status=open");
    expect(takeReturnPage()).toBe("/app/links?status=open");
    expect(takeReturnPage()).toBe("/app");
    rememberReturnPage("https://evil.example/app");
    expect(takeReturnPage()).toBe("/app");
  });
});
