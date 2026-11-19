// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  afterOnboarding,
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

describe("the page asked for", () => {
  it("waits in the tab once, and never leads off the app", () => {
    rememberReturnPage("/app/links?status=open");
    expect(takeReturnPage()).toBe("/app/links?status=open");
    expect(takeReturnPage()).toBe("/app");
    rememberReturnPage("https://evil.example/app");
    expect(takeReturnPage()).toBe("/app");
  });
});
