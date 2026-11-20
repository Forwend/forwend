import { expect, it } from "vitest";
import { namedField } from "@/shared/api/api-error";

const refused = (message: string) => ({
  status: 422,
  data: { error: { code: "invalid_value", message } },
});

it("names the field a 422 message names, and only a known one", () => {
  const fields = ["client.email", "payments"] as const;
  expect(
    namedField(refused("invalid job request: client.email must be an email address"), fields),
  ).toBe("client.email");
  expect(
    namedField(refused("invalid job request: payments need dueDays from 0 to 90"), fields),
  ).toBe("payments");
  expect(
    namedField(refused("invalid job request: a profile has at most 1000 jobs"), fields),
  ).toBeNull();
  expect(namedField({ status: "FETCH_ERROR", error: "offline" }, fields)).toBeNull();
});
