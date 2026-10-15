import { describe, expect, it } from "vitest";
import { afterOnboarding } from "@/features/onboarding/lib/onboarding";

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
