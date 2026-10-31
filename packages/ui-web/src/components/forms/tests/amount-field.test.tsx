import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AmountField } from "../amount-field";

describe("AmountField", () => {
  afterEach(() => cleanup());

  it("describes the input by its unit, then by its error", () => {
    const { rerender } = render(<AmountField label="Amount" unit="USD" hint="Above 0." />);
    const input = screen.getByRole("textbox", { name: "Amount" });
    const described = () =>
      (input.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent);
    expect(described()).toEqual(["USD", "Above 0."]);
    expect(input.getAttribute("inputmode")).toBe("decimal");

    rerender(<AmountField label="Amount" unit="USD" error="Enter an amount, such as 12.50." />);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(described()).toEqual(["USD", "Enter an amount, such as 12.50."]);
  });
});
