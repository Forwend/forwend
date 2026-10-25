import type { LucideIcon } from "lucide-react";
import type { Permission } from "@/features/profiles/types/profile";

/** A page in the sidebar; href null is a page not built yet, shown as coming. */
export interface NavItem {
  href: string | null;
  label: string;
  icon: LucideIcon;
  /** What the profile's role needs to see the page (D-93); a coming page shows to every role. */
  permission?: Permission;
}

export interface NavGroup {
  label: string;
  items: readonly NavItem[];
}

export interface Crumb {
  label: string;
  href: string;
}
