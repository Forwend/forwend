import { buttonClasses } from "@forwend/ui-web";
import { ArrowDown } from "lucide-react";
import Link from "next/link";
import { APP_ROUTES } from "@/shared/config/routes";
import styles from "../../landing.module.css";
import { HERO } from "./constants/hero-content";
import { HeroDashboard } from "./hero-dashboard";

export function LandingHero() {
  return (
    <section className={styles.hero} data-section="hero" aria-labelledby="hero-title">
      <div className={styles.heroCopy}>
        <h1 id="hero-title" className={styles.heroTitle}>
          {HERO.title}
          <br />
          {HERO.titleSub}
        </h1>
        <p className={styles.heroDescription}>{HERO.body}</p>
        <div className={styles.heroActions}>
          <Link prefetch={false} href={APP_ROUTES.signIn} className={buttonClasses({ size: "lg" })}>
            Get started
          </Link>
          <a href="#product" className={styles.textLink}>
            Explore payments <ArrowDown aria-hidden className="size-4" />
          </a>
        </div>
      </div>
      <HeroDashboard />
    </section>
  );
}
