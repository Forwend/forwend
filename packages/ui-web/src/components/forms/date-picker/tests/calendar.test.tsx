import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Calendar } from "../calendar";
import { DatePicker } from "../date-picker";

const day = (name: RegExp) => screen.getByRole("button", { name });
const focusedDay = () => document.activeElement as HTMLElement;

describe("Calendar", () => {
  afterEach(() => cleanup());

  it("moves focus with the keyboard and chooses with Enter", () => {
    const onChange = vi.fn();
    render(<Calendar label="Due date" value="2026-10-14" onChange={onChange} autoFocus />);
    const grid = screen.getByRole("grid", { name: "Due date" });
    expect(focusedDay().textContent).toBe("14");
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(focusedDay().textContent).toBe("15");
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(focusedDay().textContent).toBe("22");
    fireEvent.keyDown(grid, { key: "Home" });
    expect(focusedDay().textContent).toBe("19"); // Monday of that week
    fireEvent.keyDown(grid, { key: "End" });
    expect(focusedDay().textContent).toBe("25");
    fireEvent.keyDown(grid, { key: "PageDown" });
    expect(screen.getByText(/November 2026/)).toBeTruthy();
    expect(focusedDay().textContent).toBe("25");
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("2026-11-25");
    // One tab stop: only the focused day is in the tab order.
    expect(grid.querySelectorAll("button[tabindex='0']")).toHaveLength(1);
  });

  it("never chooses a day outside min and max or a disabled one", () => {
    const onChange = vi.fn();
    const weekend = (iso: string) => [0, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay());
    render(
      <Calendar
        label="Due date"
        value={null}
        min="2026-10-10"
        max="2026-10-20"
        isDisabled={weekend}
        onChange={onChange}
      />,
    );
    fireEvent.click(day(/October 9, 2026/));
    fireEvent.click(day(/October 11, 2026/)); // a Sunday
    fireEvent.click(day(/October 21, 2026/));
    expect(onChange).not.toHaveBeenCalled();
    expect(day(/October 9, 2026/).getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(day(/October 13, 2026/));
    expect(onChange).toHaveBeenCalledWith("2026-10-13");
    // No month to go to past max or before min.
    expect((screen.getByRole("button", { name: "Next month" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole("button", { name: "Previous month" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("DatePicker", () => {
  afterEach(() => cleanup());

  it("opens a calendar, closes on a choice and sends the ISO date with the form", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <DatePicker
        label="Due date"
        name="dueDate"
        value={null}
        onChange={onChange}
        clearLabel="Clear due date"
      />,
    );
    const trigger = screen.getByRole("button", { name: /Due date/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Due date" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.click(day(/15/));
    expect(onChange).toHaveBeenCalledTimes(1);
    const chosen = onChange.mock.calls[0]?.[0] as string;
    expect(chosen).toMatch(/^\d{4}-\d{2}-15$/);
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(
      <DatePicker
        label="Due date"
        name="dueDate"
        value={chosen}
        onChange={onChange}
        clearLabel="Clear due date"
      />,
    );
    expect((container.querySelector("input[name=dueDate]") as HTMLInputElement).value).toBe(chosen);
    fireEvent.click(screen.getByRole("button", { name: "Clear due date" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("links its error to the field", () => {
    render(
      <DatePicker
        label="Due date"
        value={null}
        onChange={() => {}}
        error="Pick a date in the future."
      />,
    );
    const trigger = screen.getByRole("button", { name: /Due date/ });
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    expect(
      document.getElementById(trigger.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toBe("Pick a date in the future.");
  });
});
