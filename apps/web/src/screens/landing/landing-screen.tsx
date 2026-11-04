import { preload } from "react-dom";
import styles from "./landing.module.css";
import { LandingFooter } from "./layout/landing-footer";
import { LandingHeader } from "./layout/landing-header";
import { Faq } from "./sections/faq";
import { ProductFeatures } from "./sections/features/product-features";
import { LandingHero } from "./sections/hero/landing-hero";
import { Roadmap } from "./sections/roadmap";
import { SupportedNetworks } from "./sections/supported-networks";

export function LandingScreen() {
  for (const [theme, art] of [
    ["light", "day"],
    ["dark", "night"],
  ] as const) {
    preload(`/images/landing-hero-${art}-mobile.webp`, {
      as: "image",
      fetchPriority: "high",
      media: `(max-width: 40rem) and (prefers-color-scheme: ${theme})`,
    });
    preload(`/images/landing-hero-${art}.webp`, {
      as: "image",
      fetchPriority: "high",
      media: `(width > 40rem) and (prefers-color-scheme: ${theme})`,
    });
  }

  return (
    <div className={styles.page}>
      <a href="#main-content" className={styles.skipLink}>
        Skip to content
      </a>
      <LandingHeader />
      <main id="main-content" tabIndex={-1}>
        <div className={styles.opening}>
          <div className={styles.landscape} aria-hidden="true" />
          <LandingHero />
        </div>
        <SupportedNetworks />
        <ProductFeatures />
        <Roadmap />
        <Faq />
      </main>
      <LandingFooter />
    </div>
  );
}
