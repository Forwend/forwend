import styles from "./landing.module.css";
import { EditorialNav } from "./layout/editorial-nav";
import { GardenFooter } from "./layout/garden-footer";
import { OpenPathHero } from "./sections/hero/open-path-hero";
import { NextChapter } from "./sections/next-chapter";
import { PaymentJourney, PaymentWorkspace } from "./sections/payment-workspace";

export function LandingScreen() {
  return (
    <div className={styles.page}>
      <a href="#main-content" className={styles.skipLink}>
        Skip to content
      </a>
      <EditorialNav />
      <main id="main-content" tabIndex={-1}>
        <OpenPathHero />
        <PaymentWorkspace />
        <PaymentJourney />
        <NextChapter />
      </main>
      <GardenFooter />
    </div>
  );
}
