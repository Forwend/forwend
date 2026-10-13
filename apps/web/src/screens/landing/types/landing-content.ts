import type {
  LANDING_SECTIONS,
  SECTION_LAYOUTS,
} from "@/screens/landing/constants/landing-content";

export type LandingSection = (typeof LANDING_SECTIONS)[keyof typeof LANDING_SECTIONS];

export type SectionLayout = (typeof SECTION_LAYOUTS)[keyof typeof SECTION_LAYOUTS];
