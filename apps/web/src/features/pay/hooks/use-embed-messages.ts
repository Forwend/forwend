import { type RefObject, useEffect, useRef } from "react";
import { invoicesApi } from "@/features/invoices/api/invoices-api";
import { EMBED_EVENTS, EMBED_MESSAGE } from "@/features/pay/constants/embed";

/** Posts ready, then only changed height and status, to the framing origin alone. */
export function useEmbedMessages(
  root: RefObject<HTMLElement | null>,
  linkToken: string,
  origin: string,
): void {
  // A poll here too would keep polling once the payment is final.
  const { data } = invoicesApi.endpoints.getInvoice.useQueryState(linkToken);
  const invoiceId = data?.invoiceId;
  const paymentStatus = data?.paymentStatus;
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
