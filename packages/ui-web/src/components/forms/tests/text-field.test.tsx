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

  it("inline, keeps its label and then its error on the input beside them", () => {
    const { rerender } = render(<TextField label="Payment limit" hint="Optional." inline />);
    const input = screen.getByRole("textbox", { name: "Payment limit" });
    expect(document.getElementById(input.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "Optional.",
    );

    rerender(<TextField label="Payment limit" error="Enter a whole number." inline />);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(input.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "Enter a whole number.",
    );
  });

  it("keeps a hidden label as the name, and a control inside the field out of it", () => {
    render(
      <TextField
        label="Wallet address"
        labelHidden
        inputClassName="font-mono"
        hint="On the network you send on."
        end={<Button>Paste</Button>}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Wallet address" });
    expect(input.className).toContain("font-mono");
    expect(input.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText("Wallet address").className).toBe("sr-only");
    expect(screen.getByRole("button", { name: "Paste" })).toBeTruthy();
    // The body font stays on the label and the hint.
    expect(screen.getByText("On the network you send on.").className).not.toContain("font-mono");
  });
});
