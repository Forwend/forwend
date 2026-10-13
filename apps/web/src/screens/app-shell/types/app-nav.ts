import type { LucideIcon } from "lucide-react";

/** A page in the sidebar; href null is a page not built yet, shown as coming. */
export interface NavItem {
  href: string | null;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  items: readonly NavItem[];
}

export interface Crumb {
  label: string;
  href: string;
}
