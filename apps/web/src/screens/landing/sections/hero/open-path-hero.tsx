import { BrandIcon, buttonClasses, LogoMark } from "@forwend/ui-web";
import { Check, Wallet } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { OPEN_PATH_IMAGE } from "@/shared/assets/images";
import { APP_ROUTES } from "@/shared/config/routes";
import styles from "../../landing.module.css";
import { HERO } from "./constants/hero-content";

export function OpenPathHero() {
  return (
    <section className={styles.hero} data-section="hero" aria-labelledby="hero-title">
      <div className={styles.heroIntro}>
        <h1 id="hero-title" className={styles.heroTitle}>
          {HERO.title}
          <br />
          <span>{HERO.titleSub}</span>
        </h1>
        <div className={styles.heroCopy}>
          <p>{HERO.body}</p>
          <div className={styles.heroActions}>
            <Link
              prefetch={false}
              href={APP_ROUTES.signIn}
              className={buttonClasses({ size: "lg" })}
            >
              Open Forwend
            </Link>
            <a href="#how-it-works" className={styles.textLink}>
              See how it works
            </a>
          </div>
        </div>
      </div>
      <div className={styles.heroScene}>
        <Image
          src={OPEN_PATH_IMAGE.src}
          alt=""
          fill
          priority
          fetchPriority="high"
          sizes="(max-width: 1440px) 100vw, 1440px"
          className={styles.heroImage}
        />
        <div className={styles.sceneCaption}>
          <span>
            A world of work.
            <br />
            One way to get paid.
          </span>
        </div>
        <div className={styles.heroReceipt}>
          <div className={styles.receiptTop}>
            <LogoMark className="size-5" />
            <span>Payment received</span>
            <span className={styles.sample}>Sample</span>
          </div>
          <div className={styles.receiptAmount}>
            1,250<span>.00</span>{" "}
            <small className={styles.assetLabel}>
              <BrandIcon name="usdc" className="size-4" /> USDC
            </small>
          </div>
          <div className={styles.receiptNote}>
            <span>Brand design · Invoice #0012</span>
            <span className={styles.assetLabel}>
              <BrandIcon name="base" className="size-3" /> Base
            </span>
          </div>
          <div className={styles.receiptProgress}>
            <span>
              <Check aria-hidden className="size-3" /> Paid
            </span>
            <span className={styles.receiptLine} />
            <span>
              <Wallet aria-hidden className="size-3" /> In your wallet
            </span>
          </div>
          <div className={styles.receiptBottom}>
            <span>From a client. To your next chapter.</span>
          </div>
        </div>
      </div>
      <div className={styles.heroFoot}>
        <p>
          Made for independent work.
          <br />
          <span>Built for a connected world.</span>
        </p>
        <div className={styles.useCases}>
          <span>Freelancers</span>
          <span>Businesses</span>
          <span>Builders</span>
        </div>
      </div>
    </section>
  );
}
