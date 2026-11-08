import { Accordion } from "@forwend/ui-web";
import layout from "../landing.module.css";
import styles from "./faq.module.css";

export function Faq() {
  return (
    <section
      id="questions"
      className={`${styles.questions} ${layout.content}`}
      aria-labelledby="questions-title"
    >
      <div>
        <h2 id="questions-title" className={layout.sectionTitle}>
          A little clarity.
        </h2>
        <p className={styles.intro}>Before your first payment.</p>
      </div>
      <Accordion
        items={[
          {
            question: "Do my customers need a Forwend account?",
            answer:
              "No. They open the payment page and pay from a wallet or exchange. The checkout shows the required token, network, address, and amount.",
          },
          {
            question: "Where does the money go?",
            answer:
              "Confirmed payments are settled into your profile wallet. Detection, confirmation, and settlement are separate steps; funds on hold are shown separately.",
          },
          {
            question: "Is Forwend available on mainnet?",
            answer:
              "Yes. Payers pay real USDC or OUSD on Base, Arbitrum, Arc and Tempo. Turn on Developer mode in a profile's settings to try everything on test networks with free test tokens.",
          },
          {
            question: "Can I withdraw to my bank?",
            answer:
              "Not yet. Bank withdrawals are planned, after agentic payments. Availability and details will follow.",
          },
          {
            question: "Can my customers pay by card?",
            answer:
              "Not yet. Card, Apple Pay and Google Pay payments are planned: the customer pays as usual and you receive stablecoins. Today customers pay from a wallet or exchange.",
          },
        ]}
      />
    </section>
  );
}
