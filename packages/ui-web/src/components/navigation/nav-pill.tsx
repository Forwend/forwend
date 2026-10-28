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
      className="mx-auto flex h-16 w-full max-w-7xl items-center gap-2 sm:gap-10"
    >
      {/* flex, not an inline span: an inline wrapper aligns the brand to its text baseline and lifts it. */}
      <span className="flex items-center font-semibold tracking-tight text-ink">{brand}</span>
      <ul className="hidden flex-1 items-center gap-7 text-sm text-muted md:flex">
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
      <span className="ml-auto md:ml-0">{action}</span>
    </nav>
  );
}
