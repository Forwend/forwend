// test/react-18 runs this file again on React 18 (R-169).
import { act, type ReactNode, StrictMode, version } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Checkout, PayButton, PaymentElement } from "../src/index.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TOKEN = "7f3a9c1e5b2d4086a1c3e5f7092b4d6f8a0c2e4f6a8b0d2f4e6c8a0b2d4f6e81";
const FORWEND = "https://forwend.com";
const ID = `0x${"0b".repeat(32)}`;
const PAID = { source: "forwend", v: 1, type: "status", invoiceId: ID, paymentStatus: "paid" };

let root: Root | null = null;
const box = document.createElement("div");
document.body.append(box);
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

function render(node: ReactNode) {
  root ??= createRoot(box);
  act(() => root?.render(node));
}
const frames = () => box.querySelectorAll("iframe");
const post = (data: unknown, source = frames()[0]?.contentWindow ?? null) =>
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, origin: FORWEND, source }));
  });

describe("@forwend/react", () => {
  it(`runs on React ${process.env.REACT_MAJOR ?? "19"}`, () => {
    expect(version.split(".")[0]).toBe(process.env.REACT_MAJOR ?? "19");
  });

  it("frames the whole checkout or its pay panel", () => {
    render(<Checkout payToken={TOKEN} />);
    expect(new URL(frames()[0]?.src ?? "").searchParams.get("layout")).toBe("full");
    render(<PaymentElement payToken={TOKEN} theme="dark" />);
    const src = new URL(frames()[0]?.src ?? "");
    expect(src.pathname).toBe(`/embed/${TOKEN}`);
    expect(src.searchParams.get("layout")).toBe("element");
    expect(src.searchParams.get("theme")).toBe("dark");
    expect(frames()).toHaveLength(1);
  });

  it("calls the latest handler without loading the checkout again", () => {
    const first = vi.fn();
    const second = vi.fn();
    render(<PaymentElement payToken={TOKEN} onStatus={first} />);
    const frame = frames()[0];
    render(<PaymentElement payToken={TOKEN} onStatus={second} />);
    expect(frames()[0]).toBe(frame);
    post(PAID);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ invoiceId: ID, paymentStatus: "paid" });
  });

  it("keeps one frame under StrictMode and leaves nothing behind when unmounted", () => {
    const onStatus = vi.fn();
    render(
      <StrictMode>
        <PaymentElement payToken={TOKEN} onStatus={onStatus} />
      </StrictMode>,
    );
    expect(frames()).toHaveLength(1);
    const source = frames()[0]?.contentWindow ?? null;
    act(() => root?.unmount());
    root = null;
    expect(frames()).toHaveLength(0);
    post(PAID, source);
    expect(onStatus).not.toHaveBeenCalled();
  });

  it("PayButton links to the hosted checkout or a payment link", () => {
    render(<PayButton payToken={TOKEN} />);
    expect(box.querySelector("a")?.href).toBe(`${FORWEND}/pay/${TOKEN}`);
    expect(box.querySelector("a")?.textContent).toBe("Pay with stablecoins");
    render(
      <PayButton linkSlug="a1b2c3d4e5f6" className="buy">
        Buy
      </PayButton>,
    );
    expect(box.querySelector("a")?.href).toBe(`${FORWEND}/l/a1b2c3d4e5f6`);
    expect(box.querySelector("a")?.className).toBe("buy");
  });
});
