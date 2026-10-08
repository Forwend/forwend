import type { LANDING_SECTIONS, PROFILES, SECTION_LAYOUTS } from "@/constants/landing";

export type LandingSection = (typeof LANDING_SECTIONS)[keyof typeof LANDING_SECTIONS];
export type ProfileTab = keyof typeof PROFILES.tabs;
export type SectionLayout = (typeof SECTION_LAYOUTS)[keyof typeof SECTION_LAYOUTS];
