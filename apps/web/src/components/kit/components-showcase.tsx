"use client";

import {
  Accordion,
  Badge,
  BUTTON_SIZES,
  BUTTON_VARIANTS,
  Button,
  CAPTURE_STATUS,
  Checkbox,
  CodeBlock,
  CodeInput,
  Dialog,
  EmailCapture,
  EmptyState,
  NavPill,
  PANEL_TONES,
  Panel,
  SelectField,
  Skeleton,
  Switch,
  Tabs,
  TextField,
  TONES,
  Toast,
  Tooltip,
} from "@forwend/ui-web";
import { useState } from "react";
import { CTA } from "@/constants/copy";
import { KitGroup } from "./kit-section";

const noop = () => {};

const SAMPLE_CODE = `const invoice = await forwend.invoices.create({
  amount: "1250.00",
  token: "USDC",
  network: "base",
}, { idempotencyKey: "order-1042" });`;

export function ComponentsShowcase() {
  const [on, setOn] = useState(true);
  const [code, setCode] = useState("826");
  return (
    <div className="flex flex-col gap-10">
      <KitGroup title="Button: variants">
        {Object.values(BUTTON_VARIANTS).map((variant) => (
          <Button key={variant} variant={variant}>
            {variant === BUTTON_VARIANTS.link ? "Read the docs" : CTA.joinWaitlist}
          </Button>
        ))}
      </KitGroup>
      <KitGroup title="Button: sizes and states">
        {Object.values(BUTTON_SIZES).map((size) => (
          <Button key={size} size={size}>
            Size {size}
          </Button>
        ))}
        <Button loading>Saving</Button>
        <Button disabled>Disabled</Button>
        <Button variant={BUTTON_VARIANTS.secondary} disabled>
          Disabled
        </Button>
      </KitGroup>
      <KitGroup title="Fields">
        <div className="grid w-full gap-6 md:grid-cols-3">
          <TextField
            label="Invoice amount"
            placeholder="1,250.00"
            hint="In USDC, up to 6 decimals."
          />
          <TextField
            label="Client email"
            defaultValue="client@"
            error="Enter a full email address, like name@company.com."
          />
          <SelectField
            label="Network"
            defaultValue="base"
            hint="Only tested networks are listed."
            options={[
              { value: "base", label: "Base" },
              { value: "arbitrum", label: "Arbitrum (planned)", disabled: true },
              { value: "arc", label: "Arc (planned)", disabled: true },
              { value: "tempo", label: "Tempo (planned)", disabled: true },
            ]}
          />
        </div>
        <div className="grid w-full gap-6 md:grid-cols-3">
          <CodeInput
            label="Code (empty)"
            value=""
            onValueChange={noop}
            hint="Paste or type 6 digits."
          />
          <CodeInput label="Code (partly typed)" value={code} onValueChange={setCode} />
          <CodeInput
            label="Code (wrong)"
            value="826104"
            onValueChange={noop}
            error="Wrong or expired code. Try again."
          />
          <CodeInput label="Code (checking)" value="826104" onValueChange={noop} disabled />
        </div>
        <Checkbox label="Send a reminder on the due date" defaultChecked />
        <Switch label="Email me when a payment settles" checked={on} onCheckedChange={setOn} />
      </KitGroup>
      <KitGroup title="Email capture: idle, submitting, success, error">
        <div className="grid w-full gap-4 md:grid-cols-2">
          <EmailCapture
            status={CAPTURE_STATUS.idle}
            onSubmit={noop}
            submitLabel={CTA.joinWaitlist}
          />
          <EmailCapture
            status={CAPTURE_STATUS.submitting}
            onSubmit={noop}
            submitLabel={CTA.joinWaitlist}
          />
          <EmailCapture
            status={CAPTURE_STATUS.success}
            message="You're on the list."
            onSubmit={noop}
            submitLabel={CTA.joinWaitlist}
          />
          <EmailCapture
            status={CAPTURE_STATUS.error}
            message="Enter a full email address, like name@company.com."
            onSubmit={noop}
            submitLabel={CTA.joinWaitlist}
          />
        </div>
      </KitGroup>
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
                  "Open a support request from the invoice page. Recovery is reviewed case by case and is not guaranteed.",
              },
            ]}
          />
        </div>
      </KitGroup>
      <KitGroup title="Dialog, tooltip, toast">
        <Dialog triggerLabel="Open dialog" title="Confirm withdrawal">
          You receive the amount shown in the quote. A new quote is needed after it expires.
        </Dialog>
        <Tooltip content="The network fee is shown before you confirm.">
          <Button variant={BUTTON_VARIANTS.ghost}>Hover for tooltip</Button>
        </Tooltip>
        <Toast
          tone={TONES.success}
          title="Payment settled"
          description="1,250.00 USDC is in your wallet."
        />
      </KitGroup>
      <KitGroup title="Loading and empty">
        <div className="flex w-64 flex-col gap-2">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
        <div className="w-full max-w-md">
          <EmptyState
            title="No invoices yet"
            description="Create your first invoice and share the link with your client."
            action={<Button size={BUTTON_SIZES.sm}>Create invoice</Button>}
          />
        </div>
      </KitGroup>
      <KitGroup title="Code block">
        <div className="w-full max-w-2xl">
          <CodeBlock code={SAMPLE_CODE} language="TypeScript" />
        </div>
      </KitGroup>
    </div>
  );
}
