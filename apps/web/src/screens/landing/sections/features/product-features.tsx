import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { docsPath } from "@/shared/config/docs-routes";
import { CheckoutVisual, InvoiceVisual, LinkVisual, StatusVisual } from "./feature-visuals";
import styles from "./product-features.module.css";

const FEATURES: readonly {
  id: string;
  title: string;
  body: string;
  points: readonly string[];
  link: { label: string; slug: string };
  visual: ReactNode;
}[] = [
  {
    id: "invoices",
    title: "Invoice a client for the work",
    body: "Add the items, a due date and your billing details. Your client gets a link and a PDF, and pays from any wallet.",
    points: [
      "A PDF for every invoice",
      "Reminders before and after the due date",
      "Clients saved for next time",
    ],
    link: { label: "How invoices work", slug: "collect/invoices" },
    visual: <InvoiceVisual />,
  },
  {
    id: "payment-links",
    title: "Share one link, get paid many times",
    body: "Set a fixed price or let people choose the amount. Post the link in a message or on your site.",
    points: [
      "Fixed or open amounts",
      "Turns off when it ends or sells out",
      "Every buyer gets their own checkout",
    ],
    link: { label: "How payment links work", slug: "collect/payment-links" },
    visual: <LinkVisual />,
  },
  {
    id: "checkout",
    title: "Add checkout to your store",
    body: "Create a checkout on your server with one request. Send buyers to the hosted page or embed it in yours.",
    points: [
      "Hosted or embedded",
      "Safe to retry with idempotency keys",
      "Prices stay on your server",
    ],
    link: { label: "Start with the API", slug: "start/first-test-payment" },
    visual: <CheckoutVisual />,
  },
  {
    id: "status",
    title: "See every step until it is in your wallet",
    body: "Detected, confirmed and in your wallet are separate steps. You see each one, and your server gets a signed webhook.",
    points: [
      "Signed, retried webhooks",
      "Testnet today on Base, Arbitrum, Arc and Tempo",
      "Exact token and network on every payment",
    ],
    link: { label: "Networks and tokens", slug: "reference/networks" },
    visual: <StatusVisual />,
  },
];

export function ProductFeatures() {
  return (
    <section id="product" className={styles.features} aria-label="Product">
      {FEATURES.map((feature, index) => (
        <article
          key={feature.id}
          className={styles.feature}
          aria-labelledby={`feature-${feature.id}`}
        >
          <div className={`${styles.copy} fw-reveal`}>
            <span className={styles.number}>{String(index + 1).padStart(2, "0")}</span>
            <h2 id={`feature-${feature.id}`}>{feature.title}</h2>
            <p>{feature.body}</p>
            <ul>
              {feature.points.map((point) => (
                <li key={point}>
                  <Check aria-hidden className={`${styles.check} size-4`} />
                  {point}
                </li>
              ))}
            </ul>
            <Link prefetch={false} href={docsPath(feature.link.slug)} className={styles.link}>
              {feature.link.label} <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
          <div className={`${styles.visual} fw-reveal fw-reveal-late`} aria-hidden="true">
            {feature.visual}
          </div>
        </article>
      ))}
    </section>
  );
}
