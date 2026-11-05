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

  // R-177: a list searched elsewhere (an API) gets what is typed and shows its answer as given.
  it("reports what is typed and leaves the matching to whoever searches", () => {
    Element.prototype.scrollIntoView = vi.fn();
    const searched = vi.fn();
    render(
      <ComboboxField
        label="Saved client"
        options={COUNTRIES}
        value=""
        onValueChange={() => {}}
        onSearchChange={searched}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Saved client/ }));
    expect(searched).toHaveBeenLastCalledWith("");
    fireEvent.change(screen.getByRole("combobox", { name: /Saved client/ }), {
      target: { value: "zzz" },
    });
    expect(searched).toHaveBeenLastCalledWith("zzz");
    expect(screen.getAllByRole("option")).toHaveLength(COUNTRIES.length);
  });

  it("names the chosen option when the answer leaves it out, and Enter waits while the answer loads", () => {
    Element.prototype.scrollIntoView = vi.fn();
    const pick = vi.fn();
    const field = (loading: boolean) => (
      <ComboboxField
        label="Saved client"
        options={COUNTRIES}
        value="XX"
        valueLabel="Bob Ltd"
        onValueChange={pick}
        onSearchChange={() => {}}
        loading={loading}
      />
    );
    const { rerender } = render(field(true));
    // The picked client isn't a row of this answer, only the field's label.
    const trigger = screen.getByRole("button", { name: /^Saved client/ });
    expect(trigger.textContent).toContain("Bob Ltd");
    fireEvent.click(trigger);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).not.toContain("Bob Ltd");
    expect(screen.getByRole("status").textContent).toBe("Searching…");
    const search = screen.getByRole("combobox", { name: /Saved client/ });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(pick).not.toHaveBeenCalled();
    rerender(field(false));
    fireEvent.keyDown(search, { key: "Enter" });
    expect(pick).toHaveBeenCalledWith("BQ");
  });
});
