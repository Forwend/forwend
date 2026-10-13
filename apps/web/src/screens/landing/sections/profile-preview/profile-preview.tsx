import { FreelancerIcon, MerchantIcon, Tabs } from "@forwend/ui-web";
import { Code2, User } from "lucide-react";
import { LANDING_SECTIONS } from "@/screens/landing/constants/landing-content";
import { Section } from "@/screens/landing/layout/section";
import {
  PROFILE_TABS,
  PROFILES,
} from "@/screens/landing/sections/profile-preview/constants/profile-preview-content";
import { DevelopersPanel } from "@/screens/landing/sections/profile-preview/developers-panel";
import { FreelancerPanel } from "@/screens/landing/sections/profile-preview/freelancer-panel";
import { MerchantPanel } from "@/screens/landing/sections/profile-preview/merchant-panel";
import { PersonalPanel } from "@/screens/landing/sections/profile-preview/personal-panel";

export function ProfilePreview() {
  return (
    <Section
      id="profiles"
      section={LANDING_SECTIONS.profiles}
      title={PROFILES.title}
      body={PROFILES.body}
    >
      <Tabs
        label="Profiles"
        defaultValue={PROFILE_TABS.freelancer}
        items={[
          {
            value: PROFILE_TABS.personal,
            label: PROFILES.tabs.personal.label,
            icon: <User aria-hidden className="size-[var(--fw-icon-sm)]" />,
            content: <PersonalPanel />,
          },
          {
            value: PROFILE_TABS.freelancer,
            label: PROFILES.tabs.freelancer.label,
            icon: <FreelancerIcon className="size-[var(--fw-icon-sm)]" />,
            content: <FreelancerPanel />,
          },
          {
            value: PROFILE_TABS.merchant,
            label: PROFILES.tabs.merchant.label,
            icon: <MerchantIcon className="size-[var(--fw-icon-sm)]" />,
            content: <MerchantPanel />,
          },
          {
            value: PROFILE_TABS.developers,
            label: PROFILES.tabs.developers.label,
            icon: <Code2 aria-hidden className="size-[var(--fw-icon-sm)]" />,
            content: <DevelopersPanel />,
          },
        ]}
      />
    </Section>
  );
}
