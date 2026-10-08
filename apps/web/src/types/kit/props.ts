import type { ReactNode } from "react";
import type { NavVariant } from "./comp";
import type { KitSectionTitle } from "./content";

export interface KitSectionProps {
  title: KitSectionTitle;
  note?: string;
  children: ReactNode;
}

export interface KitGroupProps {
  title: string;
  children: ReactNode;
}

export interface CompNavProps {
  variant: NavVariant;
}
