import { Accordion } from "@forwend/ui-web";
import { FAQ, LANDING_SECTIONS } from "@/constants/landing";
import { Section } from "./section";

export function Faq() {
  return (
    <Section id="faq" section={LANDING_SECTIONS.faq} title={FAQ.title}>
      <div className="max-w-3xl">
        <Accordion items={FAQ.items} />
      </div>
    </Section>
  );
}
