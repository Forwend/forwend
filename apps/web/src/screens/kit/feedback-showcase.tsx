"use client";

import {
  BUTTON_SIZES,
  BUTTON_VARIANTS,
  Button,
  CodeBlock,
  Dialog,
  EmptyState,
  NOTICE_ALIGNS,
  NOTICE_TONES,
  Notice,
  Skeleton,
  Stepper,
  TONES,
  Toast,
  ToastProvider,
  Tooltip,
  useToast,
} from "@forwend/ui-web";
import { useState } from "react";
import { KitGroup } from "@/screens/kit/kit-section";

const SAMPLE_CODE = `const invoice = await forwend.invoices.create({
  amount: "1250.00",
  token: "USDC",
  network: "base",
}, { idempotencyKey: "order-1042" });`;

const SAMPLE_TOASTS = [
  { title: "Payment detected", description: "250.00 USDC is confirming." },
  {
    tone: TONES.success,
    title: "Payment settled",
    description: "1,250.00 USDC is in your wallet.",
  },
  { tone: TONES.success, title: "Billing details saved" },
] as const;

export function FeedbackShowcase() {
  const [step, setStep] = useState(2);
  return (
    <>
      <KitGroup title="Dialog, tooltip, toast">
        <Dialog triggerLabel="Open dialog" title="Confirm withdrawal">
          You receive the amount shown in the quote. A new quote is needed after it expires.
        </Dialog>
        <Dialog
          triggerLabel="Open from a link"
          title="Confirm withdrawal"
          trigger={(open) => (
            <Button variant={BUTTON_VARIANTS.ghost} onClick={open}>
              Open from a link
            </Button>
          )}
        >
          Opened by its own trigger, such as a menu item or a footer link.
        </Dialog>
        <Tooltip content="The network fee is shown before you confirm.">
          <Button variant={BUTTON_VARIANTS.ghost}>Hover for tooltip</Button>
        </Tooltip>
        <Toast
          tone={TONES.success}
          title="Payment settled"
          description="1,250.00 USDC is in your wallet."
        />
        <ToastProvider>
          <ToastDemo />
        </ToastProvider>
      </KitGroup>
      <KitGroup title="Notice: one line for the whole view">
        <div className="flex w-full max-w-2xl flex-col gap-2">
          <Notice
            action={
              <Button size={BUTTON_SIZES.sm} variant="secondary">
                Try again
              </Button>
            }
          >
            We could not refresh payments. The last loaded payments are shown.
          </Notice>
          <Notice tone={NOTICE_TONES.danger}>
            Webhook delivery failed or paused. Payment status is unchanged.
          </Notice>
          <Notice align={NOTICE_ALIGNS.center} role="alert">
            Can't reach the server. Retrying…
          </Notice>
        </div>
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
        <div className="flex h-72 w-full max-w-md flex-col rounded-lg border border-dashed border-line">
          <EmptyState
            page
            title="No payment links yet"
            description="Make one for a product, a service or a top-up."
            action={<Button size={BUTTON_SIZES.sm}>New link</Button>}
          />
        </div>
      </KitGroup>
      <KitGroup title="Stepper: a finished step goes back to it">
        <div className="w-full">
          <Stepper
            label="New invoice steps"
            current={step}
            onStepClick={setStep}
            steps={[
              { id: "customer", label: "Customer" },
              { id: "items", label: "Items" },
              { id: "details", label: "Details" },
              { id: "review", label: "Review" },
            ]}
          />
        </div>
      </KitGroup>
      <KitGroup title="Code block">
        <div className="w-full max-w-2xl">
          <CodeBlock code={SAMPLE_CODE} language="TypeScript" />
        </div>
      </KitGroup>
    </>
  );
}

function ToastDemo() {
  const toast = useToast();
  const [next, setNext] = useState(0);
  return (
    <Button
      variant={BUTTON_VARIANTS.secondary}
      onClick={() => {
        const sample = SAMPLE_TOASTS[next % SAMPLE_TOASTS.length];
        if (sample) toast(sample);
        setNext(next + 1);
      }}
    >
      Show toast
    </Button>
  );
}
