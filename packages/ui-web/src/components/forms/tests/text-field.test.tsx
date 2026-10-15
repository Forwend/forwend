import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "../../buttons/button";
import { TextField } from "../text-field";

describe("TextField", () => {
  afterEach(() => cleanup());

  it("keeps its hint and then its error described when an action sits on the input's row", () => {
    const action = <Button type="submit">Send</Button>;
    const { rerender } = render(
      <TextField label="Email" hint="For this receipt only." action={action} />,
    );
    const input = screen.getByRole("textbox", { name: "Email" });
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    expect(document.getElementById(input.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "For this receipt only.",
    );

    rerender(<TextField label="Email" error="Enter a full email." action={action} />);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(input.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "Enter a full email.",
    );
  });
});
