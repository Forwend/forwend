import { Accordion } from "@forwend/ui-web";
import { Check, CircleDot, Landmark } from "lucide-react";
import layout from "../landing.module.css";
import styles from "./next-chapter.module.css";

export function NextChapter() {
  return (
    <div className={layout.content}>
      <section id="roadmap" className={styles.roadmap} aria-labelledby="roadmap-title">
        <div className={layout.journeyHeading}>
          <h2 id="roadmap-title" className={layout.sectionTitle}>
            A little further,
            <br />
            every day.
          </h2>
          <p className={styles.intro}>
            Better payments are just the beginning. Here’s where we’re going next.
          </p>
        </div>
        <ol className={layout.journeySteps}>
          <li>
            <div className={layout.stepVisual} aria-hidden="true">
              <Check />
              <span className={`${layout.stepLine} ${styles.completeLine}`} />
            </div>
            <span className={styles.status}>Done</span>
            <h3>Payments</h3>
            <p>Invoices, payment links, and checkout. The foundations are in place.</p>
          </li>
          <li aria-current="step">
            <div className={layout.stepVisual} aria-hidden="true">
              <CircleDot />
              <span className={layout.stepLine} />
            </div>
            <span className={`${styles.status} ${styles.nextStatus}`}>Coming next</span>
            <h3>Agent payments</h3>
            <p>Let software pay on your behalf, within limits you set.</p>
          </li>
          <li>
            <div className={`${layout.stepVisual} ${styles.planned}`} aria-hidden="true">
              <Landmark />
              <span className={layout.stepLine} />
            </div>
            <span className={styles.status}>Planned</span>
            <h3>Withdraw to your bank</h3>
            <p>Move from stablecoins to your bank account, with clear rates and fees.</p>
          </li>
        </ol>
      </section>

      <section id="questions" className={styles.questions} aria-labelledby="questions-title">
        <div>
          <h2 id="questions-title" className={layout.sectionTitle}>
            A few good
            <br />
            questions.
          </h2>
          <p className={styles.questionIntro}>A little clarity before you get started.</p>
        </div>
        <Accordion
          items={[
            {
              question: "What are stablecoins?",
              answer:
                "Stablecoins are digital currencies designed to follow the value of a currency, such as the US dollar. USDC is one example. Their value can still change.",
            },
            {
              question: "Do my customers need a Forwend account?",
              answer:
                "No. They can open your payment link and pay from a wallet or exchange. The checkout shows the token, network, address, and amount they need.",
            },
            {
              question: "Where does the money go?",
              answer:
                "Confirmed payments are settled into your profile’s wallet. Forwend shows each step, so you can tell when money is detected, confirmed, and in your wallet.",
            },
            {
              question: "Can I withdraw to my bank?",
              answer:
                "Not yet. Bank withdrawals are on our roadmap. We plan to show the rate, fees, and amount you’ll receive before you confirm a withdrawal.",
            },
          ]}
        />
      </section>
    </div>
  );
}
