import { afterEach, describe, expect, it, vi } from "vitest";
import { linkUrl, type MountedCheckout, mountCheckout, payUrl } from "../src/index.js";

const TOKEN = "7f3a9c1e5b2d4086a1c3e5f7092b4d6f8a0c2e4f6a8b0d2f4e6c8a0b2d4f6e81";
const FORWEND = "https://forwend.com";
const ID = `0x${"0b".repeat(32)}`;

let mounted: MountedCheckout | null = null;
afterEach(() => {
  mounted?.destroy();
  mounted = null;
  document.body.replaceChildren();
  vi.useRealTimers();
});

function mount(options: Partial<Parameters<typeof mountCheckout>[1]> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  mounted = mountCheckout(container, { payToken: TOKEN, ...options });
  return mounted;
}

const post = (
  data: unknown,
  { source = mounted?.iframe.contentWindow ?? null, origin = FORWEND } = {},
) => window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
const ready = {
  source: "forwend",
  v: 1,
  type: "ready",
  invoiceId: ID,
  height: 512,
  paymentStatus: "open",
};

describe("mountCheckout", () => {
  it("frames the store's embed for this page's origin", () => {
    const { iframe } = mount({ layout: "element", theme: "dark" });
    const src = new URL(iframe.src);
    expect(src.origin + src.pathname).toBe(`${FORWEND}/embed/${TOKEN}`);
    expect(Object.fromEntries(src.searchParams)).toEqual({
      layout: "element",
      origin: window.location.origin,
      theme: "dark",
    });
    expect(iframe.title).toBe("Forwend checkout");
    expect(iframe.allow).toBe("clipboard-write");
    expect(iframe.style.height).toBe("480px");
  });

  it("takes only the checkout's own messages: its frame, Forwend's origin and its shape", () => {
    const onReady = vi.fn();
    const onStatus = vi.fn();
    mount({ onReady, onStatus });
    post(ready, { origin: "https://evil.example" });
    post(ready, { source: window });
    post({ ...ready, source: "other" });
    post({ ...ready, v: 2 });
    post({ ...ready, height: "512" });
    post({ ...ready, type: "status", paymentStatus: 1 });
    expect(onReady).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalled();

    post(ready);
    expect(onReady).toHaveBeenCalledWith({ invoiceId: ID, height: 512, paymentStatus: "open" });
    expect(mounted?.iframe.style.height).toBe("512px");
    post({ source: "forwend", v: 1, type: "resize", invoiceId: ID, height: 700 });
    expect(mounted?.iframe.style.height).toBe("700px");
    post({ source: "forwend", v: 1, type: "status", invoiceId: ID, paymentStatus: "paid" });
    expect(onStatus).toHaveBeenCalledWith({ invoiceId: ID, paymentStatus: "paid" });
  });

  it("says when the checkout never got ready, as when the store doesn't allow this origin", () => {
    vi.useFakeTimers();
    const onLoadError = vi.fn();
    mount({ onLoadError, readyTimeout: 1000 });
    vi.advanceTimersByTime(999);
    expect(onLoadError).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLoadError).toHaveBeenCalledOnce();

    const late = vi.fn();
    mount({ onLoadError: late, readyTimeout: 1000 });
    post(ready);
    vi.advanceTimersByTime(1000);
    expect(late).not.toHaveBeenCalled();
  });

  it("removes its frame and stops listening when destroyed", () => {
    const onStatus = vi.fn();
    const onLoadError = vi.fn();
    vi.useFakeTimers();
    const { iframe, destroy } = mount({ onStatus, onLoadError, readyTimeout: 1000 });
    const source = iframe.contentWindow;
    destroy();
    expect(iframe.isConnected).toBe(false);
    post(
      { source: "forwend", v: 1, type: "status", invoiceId: ID, paymentStatus: "paid" },
      { source },
    );
    vi.advanceTimersByTime(1000);
    expect(onStatus).not.toHaveBeenCalled();
    expect(onLoadError).not.toHaveBeenCalled();
  });

  it("refuses anything but a pay token, so no other path is framed", () => {
    for (const payToken of ["", "../pay/x", TOKEN.toUpperCase(), `${TOKEN}0`]) {
      expect(() => mount({ payToken }), payToken).toThrow(TypeError);
    }
  });
});

describe("hosted links", () => {
  it("open the checkout or the payment link on Forwend", () => {
    expect(payUrl(TOKEN)).toBe(`${FORWEND}/pay/${TOKEN}`);
    expect(payUrl(TOKEN, "http://localhost:3000")).toBe(`http://localhost:3000/pay/${TOKEN}`);
    expect(linkUrl("a1b2c3d4e5f6")).toBe(`${FORWEND}/l/a1b2c3d4e5f6`);
    for (const bad of ["", "..", "a1b2c3d4e5f6/x", "A1B2C3D4E5F6"]) {
      expect(() => linkUrl(bad), bad).toThrow(TypeError);
    }
    expect(() => payUrl("x")).toThrow(TypeError);
  });
});
