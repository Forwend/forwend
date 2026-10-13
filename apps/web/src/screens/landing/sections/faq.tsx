import { Accordion } from "@forwend/ui-web";
import {
  FAQ,
  LANDING_SECTIONS,
  SECTION_LAYOUTS,
} from "@/screens/landing/constants/landing-content";
import { Section } from "@/screens/landing/layout/section";

export function Faq() {
  return (
    <Section
      id="faq"
      section={LANDING_SECTIONS.faq}
      title={FAQ.title}
      layout={SECTION_LAYOUTS.split}
    >
      <Accordion items={FAQ.items} />
    </Section>
  );
}
