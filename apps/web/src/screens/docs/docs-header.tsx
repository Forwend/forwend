"use client";

import { Button, buttonClasses, Logo, Sheet, ThemeSwitch } from "@forwend/ui-web";
import { ArrowUpRight, Menu } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { docsPath } from "@/shared/config/docs-routes";
import { APP_ROUTES } from "@/shared/config/routes";
import styles from "./docs.module.css";
import { DocsNavigation } from "./docs-navigation";
import { DocsSearch } from "./docs-search";
import type { DocsSearchEntry } from "./types/docs";

export interface DocsHeaderProps {
  currentSlug?: string;
  index: readonly DocsSearchEntry[];
}

export function DocsHeader({ currentSlug, index }: DocsHeaderProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLDivElement>(null);
  function close() {
    setOpen(false);
    trigger.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <div className={styles.brand}>
          <Link href={APP_ROUTES.site} aria-label="Forwend home">
            <Logo />
          </Link>
          <span aria-hidden="true">/</span>
          <Link href={docsPath()} className={styles.docsIdentity}>
            Docs
          </Link>
        </div>
        <div className={styles.headerActions}>
          <DocsSearch index={index} />
          <ThemeSwitch />
          <Link
            href={APP_ROUTES.signIn}
            className={`${buttonClasses({ variant: "ghost" })} ${styles.appLink}`}
          >
            Open app <ArrowUpRight aria-hidden className="size-4" />
          </Link>
        </div>
      </div>
      <div ref={trigger} className={styles.mobileBar}>
        <Button variant="ghost" onClick={() => setOpen(true)} aria-expanded={open}>
          <Menu aria-hidden className="size-4" />
          Navigation
        </Button>
        <Link href={APP_ROUTES.signIn}>
          Open app <ArrowUpRight aria-hidden className="size-4" />
        </Link>
      </div>
      <Sheet
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        title="Documentation navigation"
      >
        <DocsNavigation currentSlug={currentSlug} onNavigate={close} />
      </Sheet>
    </header>
  );
}
