import { describe, expect, it } from "vitest";
import { isEmail } from "@/features/waitlist/lib/waitlist";

describe("isEmail", () => {
  it.each(["name@example.com", "  first.last+tag@sub.domain.io  "])("accepts %s", (value) => {
    expect(isEmail(value)).toBe(true);
  });

  it.each(["", "abc", "name@", "@example.com", "name@example", "na me@example.com"])(
    "rejects %j",
    (value) => {
      expect(isEmail(value)).toBe(false);
    },
  );
});
