import { Check } from "lucide-react";
import layout from "../landing.module.css";
import styles from "./roadmap.module.css";

export function Roadmap() {
  return (
    <section id="roadmap" className={styles.roadmap} aria-labelledby="roadmap-title">
      <div className={`${layout.content} ${styles.roadmapGrid}`}>
        <div className={styles.roadmapIntro}>
          <h2 id="roadmap-title" className={layout.sectionTitle}>
            Payments today. More ways to move money next.
          </h2>
          <p>What works now, and what we are building after it.</p>
        </div>
        <ol className={styles.timeline}>
          <li className={styles.done}>
            <span className={styles.dot} aria-hidden="true">
              <Check className="size-3.5" />
            </span>
            <span className={styles.status}>Done</span>
            <h3>Payments</h3>
            <p>Create invoices, share payment links, and accept checkout payments.</p>
            <ul className={styles.shipped} aria-label="Available now">
              <li>Invoices and PDFs</li>
              <li>Payment links</li>
              <li>Hosted and embedded checkout</li>
              <li>Signed webhooks</li>
              <li className={styles.added}>Pay from other chains</li>
            </ul>
          </li>
          <li className={styles.next}>
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.status}>Coming next</span>
            <h3>Agentic payments</h3>
            <p>Payments initiated by software on your behalf. Further details will follow.</p>
          </li>
          <li className={styles.planned}>
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.status}>Planned</span>
            <h3>Bank withdrawals</h3>
            <p>Move stablecoin funds to a bank account. Availability and details will follow.</p>
          </li>
          <li className={styles.planned}>
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.status}>Planned</span>
            <h3>Card and wallet payments</h3>
            <p>
              Customers pay with a card, Apple Pay or Google Pay, with no crypto knowledge. You
              still receive stablecoins.
            </p>
          </li>
        </ol>
      </div>
    </section>
  );
}
