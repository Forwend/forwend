import { type RefObject, useEffect, useRef } from "react";
import { useGetInvoiceQuery } from "@/features/invoices/api/invoices-api";
import { EMBED_EVENTS, EMBED_MESSAGE } from "@/features/pay/constants/embed";
import { LIVE_QUERY } from "@/shared/config/refresh";

/** R-168: tells the page that frames the checkout its height and payment status, posted to that page's origin only.
 * ready comes once the invoice is drawn; then resize and status say only what changed. */
export function useEmbedMessages(
  root: RefObject<HTMLElement | null>,
  linkToken: string,
  origin: string,
): void {
  const { data } = useGetInvoiceQuery(linkToken, LIVE_QUERY);
  const invoiceId = data?.invoiceId;
  const paymentStatus = data?.paymentStatus;
  // What the page last heard. It outlives the effect, which runs again on each status.
  const heard = useRef<{ height: number; paymentStatus: string } | null>(null);
  useEffect(() => {
    const element = root.current;
    if (!invoiceId || !paymentStatus || !element || window.parent === window) return;
    const post = (type: string, fields: object) =>
      window.parent.postMessage(
        { source: EMBED_MESSAGE.source, v: EMBED_MESSAGE.version, type, invoiceId, ...fields },
        origin,
      );
    if (heard.current && heard.current.paymentStatus !== paymentStatus) {
      heard.current.paymentStatus = paymentStatus;
      post(EMBED_EVENTS.status, { paymentStatus });
    }
    // Once per frame at most, after layout: a step's motion would otherwise send a height per change.
    let frame = 0;
    const measure = () => {
      frame = 0;
      const height = Math.ceil(element.getBoundingClientRect().height);
      if (!heard.current) {
        heard.current = { height, paymentStatus };
        post(EMBED_EVENTS.ready, { height, paymentStatus });
      } else if (height !== heard.current.height) {
        heard.current.height = height;
        post(EMBED_EVENTS.resize, { height });
      }
    };
    const observer = new ResizeObserver(() => {
      frame ||= requestAnimationFrame(measure);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [root, invoiceId, paymentStatus, origin]);
}
