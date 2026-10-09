import type { LucideIcon } from "lucide-react";

/** A page in the sidebar and tab bar; href null is a page not built yet, shown as coming. */
export interface NavItem {
  href: string | null;
  label: string;
  icon: LucideIcon;
}
