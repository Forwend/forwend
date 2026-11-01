import { buttonClasses, Logo } from "@forwend/ui-web";
import Image from "next/image";
import Link from "next/link";
import { APP_ROUTES } from "@/shared/config/routes";
import styles from "./garden-footer.module.css";

export function GardenFooter() {
  return (
    <footer className={styles.footer}>
      <section className={styles.garden} aria-labelledby="footer-title">
        <Image
          src="/images/landing-day-garden.webp"
          alt=""
          fill
          sizes="100vw"
          className={`${styles.art} ${styles.dayArt}`}
        />
        <Image
          src="/images/landing-evening-garden.webp"
          alt=""
          fill
          sizes="100vw"
          className={`${styles.art} ${styles.nightArt}`}
        />
        <div className={styles.veil} />
        <div className={styles.invitation}>
          <h2 id="footer-title">
            Good work.
            <br />
            Let’s move it forward.
          </h2>
          <p>Your next payment starts here.</p>
          <Link prefetch={false} href={APP_ROUTES.signIn} className={buttonClasses({ size: "lg" })}>
            Open Forwend
          </Link>
        </div>
      </section>
      <div className={styles.bottom}>
        <div>
          <Link
            prefetch={false}
            href={APP_ROUTES.site}
            aria-label="Forwend home"
            className={styles.home}
          >
            <Logo className={styles.logo} />
          </Link>
        </div>
        <nav aria-label="Footer" className={styles.links}>
          <Link prefetch={false} href={APP_ROUTES.docs}>
            Developer docs
          </Link>
          <a href="#roadmap">Roadmap</a>
          <a href="#questions">Questions</a>
        </nav>
        <p className={styles.copyright}>© {new Date().getUTCFullYear()} Forwend</p>
      </div>
    </footer>
  );
}
