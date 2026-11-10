import { ArrowRight, ReceiptText, ToggleRight, Undo2 } from "lucide-react";
import Link from "next/link";
import { NearIntents } from "@/shared/components/chains/near-intents";
import { docsPath } from "@/shared/config/docs-routes";
import layout from "../../landing.module.css";
import features from "../features/product-features.module.css";
import styles from "./cross-chain.module.css";
import { CrossChainRoute } from "./cross-chain-route";

const FACTS = [
  {
    icon: ReceiptText,
    title: "Fee shown first",
    body: "The customer pays it, and your invoice is paid in full.",
  },
  {
    icon: Undo2,
    title: "Refunds go to the customer",
    body: "Money that can’t convert returns to their own address.",
  },
  {
    icon: ToggleRight,
    title: "On for invoices, links and checkout",
    body: "Wherever you accept USDC on Base, in live mode. Turn it off in settings.",
  },
] as const;

export function CrossChainPayments({ number }: { number: string }) {
  return (
    <section id="cross-chain" className={styles.section} aria-labelledby="cross-chain-title">
      <div className={layout.content}>
        <div className={`${styles.head} fw-reveal`}>
          <span className={features.number}>{number}</span>
          <h2 id="cross-chain-title">Cross-chain payments</h2>
          <p className={styles.powered}>
            Powered by <NearIntents />
          </p>
          <p className={styles.lead}>
            Your customer pays with a token they already hold. You receive USDC on Base.
          </p>
        </div>
        <CrossChainRoute />
        <ul className={styles.facts}>
          {FACTS.map((fact) => (
            <li key={fact.title}>
              <span className={styles.tile}>
                <fact.icon aria-hidden className="size-5" />
              </span>
              <span>
                <strong>{fact.title}</strong>
                {fact.body}
              </span>
            </li>
          ))}
        </ul>
        <Link
          prefetch={false}
          href={docsPath("payments/cross-chain")}
          className={`${features.link} ${styles.docs}`}
        >
          How cross-chain payments work <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
    </section>
  );
}
