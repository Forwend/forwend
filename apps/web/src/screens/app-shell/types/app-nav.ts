import type { LucideIcon } from "lucide-react";
import type { Permission, ProfileKind } from "@/features/profiles/types/profile";

/** A page in the sidebar; href null is a page not built yet, shown as coming. */
export interface NavItem {
  href: string | null;
  label: string;
  icon: LucideIcon;
  permission?: Permission; // none: every role sees it
}

export interface NavGroup {
  label: string;
  items: readonly NavItem[];
}

export interface Crumb {
  label: string;
  href: string;
}

export interface SettingsPage {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: Permission;
  profile: boolean; // false: the person's own page
  kind?: ProfileKind; // none: every profile kind
}
