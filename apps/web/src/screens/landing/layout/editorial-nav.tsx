"use client";

import { buttonClasses, IconButton, Logo, ThemeSwitch } from "@forwend/ui-web";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { APP_ROUTES } from "@/shared/config/routes";
import styles from "./editorial-nav.module.css";

const links = [
  { label: "Product", href: "#product" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Roadmap", href: "#roadmap" },
  { label: "Questions", href: "#questions" },
] as const;

export function EditorialNav() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const header = useRef<HTMLElement>(null);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 60rem)");
    function closeOnDesktop(event: MediaQueryListEvent) {
      if (event.matches) setOpen(false);
    }
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    }
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !header.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [open]);

  return (
    <header ref={header} className={styles.header} data-section="nav">
      <div className={styles.navInner}>
        <Link
          prefetch={false}
          href={APP_ROUTES.site}
          aria-label="Forwend home"
          className={styles.brand}
        >
          <Logo />
        </Link>
        <nav aria-label="Main navigation" className={styles.desktopLinks}>
          {links.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        <div className={styles.navActions}>
          <ThemeSwitch />
          <Link
            prefetch={false}
            href={APP_ROUTES.signIn}
            className={`${buttonClasses({ variant: "secondary" })} ${styles.navCta}`}
          >
            Open Forwend
          </Link>
          <IconButton
            ref={trigger}
            label={open ? "Close menu" : "Open menu"}
            size="md"
            aria-expanded={open}
            aria-controls="landing-mobile-menu"
            onClick={() => setOpen((current) => !current)}
            className={styles.menuButton}
          >
            {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
          </IconButton>
        </div>
      </div>
      <nav
        id="landing-mobile-menu"
        aria-label="Mobile navigation"
        data-open={open}
        aria-hidden={!open}
        inert={!open}
        className={styles.mobileLinks}
      >
        <div className={styles.mobileClip}>
          <div className={styles.mobileLinksInner}>
            {links.map((link) => (
              <a key={link.href} href={link.href} onClick={() => setOpen(false)}>
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </nav>
    </header>
  );
}
