import { FreelancerIcon, MerchantIcon, Tabs } from "@forwend/ui-web";
import { Code2, User } from "lucide-react";
import { LANDING_SECTIONS, PROFILE_TABS, PROFILES } from "@/constants/landing";
import { DevelopersPanel, FreelancerPanel, MerchantPanel, PersonalPanel } from "./profile-panels";
import { Section } from "./section";

export function Profiles() {
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
