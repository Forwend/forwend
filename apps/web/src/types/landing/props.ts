import type { StepState } from "@forwend/ui-web";
import type { ReactNode } from "react";
import type { LandingSection, ProfileTab, SectionLayout } from "./content";

export interface SectionProps {
  id?: string;
  section: LandingSection;
  title: string;
  body?: string;
  children: ReactNode;
  className?: string;
  layout?: SectionLayout;
}

export interface ProfilePanelLayoutProps {
  tab: ProfileTab;
  children: ReactNode;
}

export interface WaitlistFormProps {
  /** Distinguishes the hero and closing forms; used for the anchor id. */
  id: string;
}

export interface HeroPaymentProps {
  states: readonly StepState[];
}
