import { buttonClasses, Logo } from "@forwend/ui-web";
import Link from "next/link";
import { APP_ROUTES } from "@/shared/config/routes";
import { FooterSocials } from "./footer-socials";
import styles from "./landing-footer.module.css";

export function LandingFooter() {
  return (
    <footer className={styles.footer}>
      <section className={styles.garden} aria-labelledby="footer-title">
        <picture className={styles.dayArt}>
          <source media="(max-width: 40rem)" srcSet="/images/landing-footer-day-mobile.webp" />
          <img
            src="/images/landing-footer-day.webp"
            alt=""
            width={1774}
            height={887}
            loading="lazy"
            decoding="async"
            className={styles.art}
          />
        </picture>
        <picture className={styles.nightArt}>
          <source media="(max-width: 40rem)" srcSet="/images/landing-footer-night-mobile.webp" />
          <img
            src="/images/landing-footer-night.webp"
            alt=""
            width={1774}
            height={887}
            loading="lazy"
            decoding="async"
            className={styles.art}
          />
        </picture>
        <div className={styles.veil} />
        <div className={styles.invitation}>
          <h2 id="footer-title">
            Ready for your
            <br />
            next payment?
          </h2>
          <Link prefetch={false} href={APP_ROUTES.signIn} className={buttonClasses({ size: "lg" })}>
            Get started
          </Link>
        </div>
      </section>
      <div className={styles.bottom}>
        <Link
          prefetch={false}
          href={APP_ROUTES.site}
          aria-label="Forwend home"
          className={styles.home}
        >
          <Logo />
        </Link>
        <nav aria-label="Footer" className={styles.links}>
          <a href="#product">Product</a>
          <a href="#roadmap">Roadmap</a>
          <Link prefetch={false} href={APP_ROUTES.docs}>
            Docs
          </Link>
        </nav>
        <FooterSocials />
        <p className={styles.copyright}>© {new Date().getUTCFullYear()} Forwend</p>
      </div>
    </footer>
  );
}
