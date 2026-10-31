import {
  CHECKOUT_EVENTS,
  type CheckoutReadyEvent,
  type CheckoutStatusEvent,
  checkoutMessage,
} from "./messages.js";

export const CHECKOUT_LAYOUTS = {
  /** The whole checkout. */
  full: "full",
  /** Its pay panel, for your own checkout page that already shows the order. */
  element: "element",
} as const;

export type CheckoutLayout = (typeof CHECKOUT_LAYOUTS)[keyof typeof CHECKOUT_LAYOUTS];

export const CHECKOUT_THEMES = {
  light: "light",
  dark: "dark",
} as const;

export type CheckoutTheme = (typeof CHECKOUT_THEMES)[keyof typeof CHECKOUT_THEMES];

/** Forwend's web app, where checkouts live. */
export const FORWEND_URL = "https://forwend.com";

// Until the checkout says how tall it is: about its first step, so the page barely moves when it does.
const INITIAL_HEIGHT: Record<CheckoutLayout, number> = { full: 720, element: 480 };
const READY_MS = 15_000;
const PAY_TOKEN = /^[0-9a-f]{64}$/;
const LINK_SLUG = /^[a-z0-9]{12}$/;

export interface CheckoutOptions {
  /** The pay token of a checkout your server created. */
  payToken: string;
  /** full by default. */
  layout?: CheckoutLayout;
  /** The visitor's system theme by default. */
  theme?: CheckoutTheme;
  /** FORWEND_URL by default; your local web app while you develop. */
  baseUrl?: string;
  /** The frame's name for screen readers. */
  title?: string;
  /** The frame's height in pixels until the checkout reports its own. */
  initialHeight?: number;
  /** Milliseconds to wait for ready before onLoadError. */
  readyTimeout?: number;
  onReady?: (event: CheckoutReadyEvent) => void;
  onStatus?: (event: CheckoutStatusEvent) => void;
  /** No ready in time: the store doesn't allow this page's origin, or the checkout did not load. */
  onLoadError?: () => void;
}

export interface MountedCheckout {
  iframe: HTMLIFrameElement;
  /** Removes the frame and stops listening. */
  destroy(): void;
}

/** The hosted checkout's address, for a pay button or a redirect: it needs no script. */
export function payUrl(payToken: string, baseUrl: string = FORWEND_URL): string {
  return new URL(`/pay/${checkedToken(payToken)}`, baseUrl).href;
}

/** A payment link's address. */
export function linkUrl(slug: string, baseUrl: string = FORWEND_URL): string {
  if (!LINK_SLUG.test(slug)) {
    throw new TypeError("slug must be the payment link's 12-character slug");
  }
  return new URL(`/l/${slug}`, baseUrl).href;
}

/** Frames the checkout in container. Only an origin the store allows can show it; the frame then fits its content.
 * Its events are hints for the page: a paid order is fulfilled from the webhook, never from them. */
export function mountCheckout(container: HTMLElement, options: CheckoutOptions): MountedCheckout {
  const layout = options.layout ?? CHECKOUT_LAYOUTS.full;
  const base = new URL(options.baseUrl ?? FORWEND_URL);
  const src = new URL(`/embed/${checkedToken(options.payToken)}`, base);
  src.searchParams.set("layout", layout);
  src.searchParams.set("origin", window.location.origin);
  if (options.theme) src.searchParams.set("theme", options.theme);

  const iframe = document.createElement("iframe");
  iframe.src = src.href;
  iframe.title = options.title ?? "Forwend checkout";
  iframe.allow = "clipboard-write";
  iframe.style.cssText = `display:block;width:100%;border:0;height:${options.initialHeight ?? INITIAL_HEIGHT[layout]}px`;
  if (window.matchMedia?.("(prefers-reduced-motion: no-preference)").matches) {
    iframe.style.transition = "height 200ms ease-out";
  }

  let ready = false;
  const timer = window.setTimeout(() => {
    if (!ready) options.onLoadError?.();
  }, options.readyTimeout ?? READY_MS);
  const listen = (event: MessageEvent) => {
    const message = checkoutMessage(event, iframe, base.origin);
    if (!message) return;
    if (message.type === CHECKOUT_EVENTS.status) {
      options.onStatus?.({ invoiceId: message.invoiceId, paymentStatus: message.paymentStatus });
      return;
    }
    iframe.style.height = `${message.height}px`;
    if (message.type === CHECKOUT_EVENTS.ready) {
      ready = true;
      window.clearTimeout(timer);
      const { invoiceId, height, paymentStatus } = message;
      options.onReady?.({ invoiceId, height, paymentStatus });
    }
  };
  window.addEventListener("message", listen);
  container.append(iframe);
  return {
    iframe,
    destroy() {
      window.removeEventListener("message", listen);
      window.clearTimeout(timer);
      iframe.remove();
    },
  };
}

function checkedToken(payToken: string): string {
  if (!PAY_TOKEN.test(payToken)) {
    throw new TypeError("payToken must be the checkout's 64-character pay token");
  }
  return payToken;
}
