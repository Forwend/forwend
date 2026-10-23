"use client";

import { IconButton } from "@forwend/ui-web";
import { Menu, X } from "lucide-react";
import { NAV_LINKS, NAV_MENU } from "@/screens/landing/constants/landing-content";

// Phones only. A native popover keeps the landing page free of a menu library.
export function SiteMenu() {
  return (
    <>
      <IconButton
        popoverTarget="site-menu"
        label={NAV_MENU}
        className="group text-ink md:hidden [&:has(+:popover-open)]:bg-surface-2"
      >
        <Menu
          aria-hidden
          className="size-[var(--fw-icon-sm)] group-[&:has(+:popover-open)]:hidden"
        />
        <X
          aria-hidden
          className="hidden size-[var(--fw-icon-sm)] group-[&:has(+:popover-open)]:block"
        />
      </IconButton>
      <div
        id="site-menu"
        popover="auto"
        className="left-[max(1rem,env(safe-area-inset-left))] right-[max(1rem,env(safe-area-inset-right))] top-[calc(5rem+env(safe-area-inset-top))] bottom-auto m-0 h-auto w-auto origin-top rounded-lg border border-line bg-surface p-1.5 text-ink shadow-lg [--fw-pop-y:-4px] motion-safe:open:animate-[fw-pop-in_var(--fw-duration-fast)_var(--fw-ease-out)]"
      >
        <ul className="flex flex-col">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                onClick={(e) => e.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover()}
                className="flex min-h-11 items-center rounded-md px-3 text-sm hover:bg-surface-2"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
