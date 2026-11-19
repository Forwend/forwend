import {
  Accordion,
  Badge,
  BUTTON_SIZES,
  Button,
  NavPill,
  PANEL_TONES,
  Panel,
  Tabs,
  TONES,
} from "@forwend/ui-web";
import { CTA } from "@/screens/kit/constants/sample-cta";
import { KitGroup } from "@/screens/kit/kit-section";

export function DisplayShowcase() {
  return (
    <>
      <KitGroup title="Badges">
        {Object.values(TONES).map((tone) => (
          <Badge key={tone} tone={tone}>
            {tone}
          </Badge>
        ))}
      </KitGroup>
      <KitGroup title="Navigation">
        <div className="w-full rounded-xl bg-surface-2 p-6">
          <NavPill
            brand="Forwend"
            links={[
              { href: "#product", label: "Product" },
              { href: "#developers", label: "Developers" },
              { href: "#faq", label: "FAQ" },
            ]}
            action={<Button size={BUTTON_SIZES.sm}>{CTA.joinWaitlist}</Button>}
          />
        </div>
      </KitGroup>
      <KitGroup title="Panels">
        <Panel className="w-64">
          <p className="font-medium">Solid panel</p>
          <p className="mt-1 text-sm text-muted">Default for app content.</p>
        </Panel>
        <div className="rounded-xl bg-[linear-gradient(160deg,var(--fw-info-soft),var(--fw-success-soft))] p-6">
          <Panel tone={PANEL_TONES.glass} className="w-64">
            <p className="font-medium">Glass panel</p>
            <p className="mt-1 text-sm text-muted">Only over imagery.</p>
          </Panel>
        </div>
      </KitGroup>
      <KitGroup title="Tabs">
        <Tabs
          label="Profiles"
          items={[
            {
              value: "personal",
              label: "Personal",
              content: <p className="text-muted">Hold, send and withdraw.</p>,
            },
            {
              value: "freelancer",
              label: "Freelancer",
              content: <p className="text-muted">Invoices and payment links.</p>,
            },
            {
              value: "merchant",
              label: "Merchant",
              content: <p className="text-muted">Checkout and stores.</p>,
            },
          ]}
        />
      </KitGroup>
      <KitGroup title="Accordion">
        <div className="w-full max-w-2xl">
          <Accordion
            items={[
              {
                question: "Who holds my money?",
                answer: "Settled funds go to a wallet that belongs to your profile.",
              },
              {
                question: "What if I send on the wrong network?",
                answer:
                  "Email support with the transaction link. Recovery is reviewed case by case and is not guaranteed.",
              },
            ]}
          />
        </div>
      </KitGroup>
    </>
  );
}
