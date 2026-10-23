import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComboboxField } from "../combobox-field";

const COUNTRIES = [
  { value: "BQ", label: "Caribbean Netherlands" },
  { value: "CH", label: "Switzerland" },
  { value: "CI", label: "Côte d'Ivoire" },
  { value: "NL", label: "Netherlands" },
];

describe("ComboboxField", () => {
  afterEach(() => cleanup());

  // The browser tests type plain ASCII names only, so accents are covered here.
  it("puts a label that starts with the search first, ignores accents, and picks with Enter", () => {
    // jsdom has no layout, and the list scrolls its active option into view.
    Element.prototype.scrollIntoView = vi.fn();
    const pick = vi.fn();
    render(<ComboboxField label="Country" options={COUNTRIES} value="" onValueChange={pick} />);
    fireEvent.click(screen.getByRole("button", { name: /^Country/ }));
    const search = screen.getByRole("combobox", { name: /Country/ });

    fireEvent.change(search, { target: { value: "nether" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Netherlands",
      "Caribbean Netherlands",
    ]);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(pick).toHaveBeenCalledWith("NL");

    fireEvent.click(screen.getByRole("button", { name: /^Country/ }));
    fireEvent.change(screen.getByRole("combobox", { name: /Country/ }), {
      target: { value: "cote" },
    });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Côte d'Ivoire"]);
  });
});
