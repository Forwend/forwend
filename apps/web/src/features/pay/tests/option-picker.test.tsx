// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { InvoiceOption } from "@/features/invoices/invoices";
import { OptionPicker } from "@/features/pay/option-picker";

const option = (optionId: string, chainId: number, symbol: string): InvoiceOption => ({
  optionId,
  chainId,
  network: "",
  token: `0x${"1".repeat(40)}`,
  symbol,
  decimals: 6,
  amount: "1000000",
  receiveAddress: `0x${"2".repeat(40)}`,
});
const OPTIONS = [
  option("base-usdc", 84532, "USDC"),
  option("base-eurc", 84532, "EURC"),
  option("arb-usdc", 421614, "USDC"),
];

function Picker({ start }: { start?: string }) {
  const [picked, setPicked] = useState(start);
  return (
    <>
      <OptionPicker options={OPTIONS} picked={picked} onPick={setPicked} />
      <output>{picked ?? "none"}</output>
    </>
  );
}

afterEach(cleanup);

describe("OptionPicker", () => {
  it("asks for the network, then only the tokens on it", () => {
    render(<Picker />);
    expect(screen.queryByRole("group", { name: "Token" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Base Sepolia" }));
    expect(screen.getByRole("status").textContent).toBe("none");
    const tokens = screen.getByRole("group", { name: "Token" });
    expect(tokens.textContent).toContain("USDC");
    expect(tokens.textContent).toContain("EURC");
    fireEvent.click(screen.getByRole("radio", { name: "EURC" }));
    expect(screen.getByRole("status").textContent).toBe("base-eurc");
  });

  it("picks a network's only token at once, and a new network clears a token it does not carry", () => {
    render(<Picker start="base-eurc" />);
    expect((screen.getByRole("radio", { name: "Base Sepolia" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByRole("radio", { name: "EURC" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Arbitrum Sepolia" }));
    expect(screen.getByRole("status").textContent).toBe("arb-usdc");
    expect(screen.queryByRole("group", { name: "Token" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Base Sepolia" }));
    expect(screen.getByRole("status").textContent).toBe("none");
  });
});
