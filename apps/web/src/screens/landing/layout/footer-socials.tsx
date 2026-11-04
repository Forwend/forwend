"use client";

import { BrandIcon, IconButton, Tooltip } from "@forwend/ui-web";
import styles from "./landing-footer.module.css";

export function FooterSocials() {
  return (
    <div className={styles.socials}>
      <span>Social channels coming soon</span>
      <div className={styles.socialButtons}>
        <Tooltip content="Soon...">
          <IconButton label="X" size="md" aria-disabled="true" className={styles.unavailable}>
            <BrandIcon name="x" className="size-4" />
          </IconButton>
        </Tooltip>
        <Tooltip content="Soon...">
          <IconButton label="GitHub" size="md" aria-disabled="true" className={styles.unavailable}>
            <BrandIcon name="github" className="size-5" />
          </IconButton>
        </Tooltip>
        <Tooltip content="Soon...">
          <IconButton
            label="LinkedIn"
            size="md"
            aria-disabled="true"
            className={styles.unavailable}
          >
            <BrandIcon name="linkedin" className="size-4" />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
}
