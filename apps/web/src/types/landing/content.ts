import type { LANDING_SECTIONS, PROFILES } from "@/constants/landing";

export type LandingSection = (typeof LANDING_SECTIONS)[keyof typeof LANDING_SECTIONS];
export type ProfileTab = keyof typeof PROFILES.tabs;
