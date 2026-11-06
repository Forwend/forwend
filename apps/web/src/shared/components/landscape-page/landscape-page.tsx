import Image from "next/image";
import type { ReactNode } from "react";
import { SiteBar, SiteBarRow, SiteBrand } from "@/shared/components/site-bar/site-bar";
import styles from "./landscape-page.module.css";

/** A page of one centered message or form over the landscape strip, as sign-in and 404 are. The logo sits as in the
 * landing's bar, so it does not move between the pages. */
export function LandscapePage({ homeLabel, children }: { homeLabel: string; children: ReactNode }) {
  return (
    <div className={`flex min-h-dvh flex-col bg-bg ${styles.page}`}>
      <div className={styles.landscape} aria-hidden="true">
        <Image
          src="/images/sign-in-day.webp"
          alt=""
          fill
          sizes="100vw"
          className={`${styles.art} ${styles.dayArt}`}
        />
        <Image
          src="/images/sign-in-night.webp"
          alt=""
          fill
          sizes="100vw"
          className={`${styles.art} ${styles.nightArt}`}
        />
        <div className={styles.fade} />
      </div>
      <SiteBar plain>
        <SiteBarRow>
          <SiteBrand label={homeLabel} />
        </SiteBarRow>
      </SiteBar>
      <main className={styles.main}>
        <div className="mx-auto w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
