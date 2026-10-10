import type { ReactNode } from "react";

export interface NavLink {
  href: string;
  label: string;
}

export interface NavPillProps {
  brand: ReactNode;
  links: readonly NavLink[];
  action?: ReactNode;
}

export function NavPill({ brand, links, action }: NavPillProps) {
  return (
    <nav
      aria-label="Main"
      className="mx-auto flex w-fit max-w-full items-center gap-2 rounded-pill border border-[color-mix(in_oklab,var(--fw-surface)_70%,transparent)] bg-glass py-1.5 pr-1.5 pl-5 shadow-md backdrop-blur-glass sm:gap-6"
    >
      {/* flex, not an inline span: an inline wrapper aligns the brand to its text baseline and lifts it. */}
      <span className="flex items-center font-semibold tracking-tight text-ink">{brand}</span>
      <ul className="hidden items-center gap-5 text-sm text-muted md:flex">
        {links.map((link) => (
          <li key={link.href}>
            <a
              href={link.href}
              className="transition-colors duration-[var(--fw-duration-fast)] hover:text-ink"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
      {action}
    </nav>
  );
}
