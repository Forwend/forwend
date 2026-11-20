import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FULL_DATE } from "../calendar-grid";
import { toTime } from "../iso-date";
import { RangeCalendar } from "../range-calendar";

describe("the range calendar's keys", () => {
  afterEach(() => cleanup());

  it("moves a month with Page Down and a year with Shift", () => {
    const { container } = render(
      <RangeCalendar label="Period" from="2026-03-10" to={null} onPick={() => {}} />,
    );
    const focused = () =>
      container.querySelector("button[tabindex='0']")?.getAttribute("aria-label");
    const press = (shiftKey: boolean) =>
      fireEvent.keyDown(container.querySelector("button[tabindex='0']") as Element, {
        key: "PageDown",
        shiftKey,
      });

    press(false);
    expect(focused()).toBe(FULL_DATE.format(toTime("2026-04-10")));
    press(true);
    expect(focused()).toBe(FULL_DATE.format(toTime("2027-04-10")));
  });
});
