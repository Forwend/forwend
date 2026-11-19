"use client";

import {
  ActionButton,
  Badge,
  BUTTON_SIZES,
  BUTTON_VARIANTS,
  Button,
  ChoiceCard,
  Form,
  HoldButton,
  IconButton,
  RowButton,
  Tooltip,
} from "@forwend/ui-web";
import { ArrowDownLeft, ArrowUpRight, Info, Landmark, Moon, X } from "lucide-react";
import { useState } from "react";
import { CTA } from "@/features/waitlist/constants/waitlist";
import { KitGroup } from "@/screens/kit/kit-section";

export function ButtonsShowcase() {
  const [cardChoice, setCardChoice] = useState("merchant");
  return (
    <>
      <KitGroup title="Button: variants">
        {Object.values(BUTTON_VARIANTS).map((variant) => (
          <Button key={variant} variant={variant}>
            {variant === BUTTON_VARIANTS.link
              ? "Read the docs"
              : variant === BUTTON_VARIANTS.danger
                ? "Cancel invoice"
                : CTA.joinWaitlist}
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
      <KitGroup title="Hold button: press and hold to confirm; loading and disabled">
        <HoldButton onHold={() => {}}>Hold to send 25.00 USDC</HoldButton>
        <HoldButton onHold={() => {}} loading>
          Hold to send 25.00 USDC
        </HoldButton>
        <HoldButton onHold={() => {}} disabled>
          Hold to send 25.00 USDC
        </HoldButton>
      </KitGroup>
      <KitGroup title="Action buttons: primary, default, not yet available">
        <ActionButton icon={ArrowDownLeft} label="Receive" primary />
        <ActionButton icon={ArrowUpRight} label="Send" />
        <ActionButton
          icon={Landmark}
          label="Withdraw"
          disabledReason="Coming soon: withdraw to your bank account."
        />
      </KitGroup>
      <KitGroup title="Icon buttons: inline hint, toolbar, avatar; Soon">
        <Tooltip content="An estimate in USD">
          <IconButton label="An estimate in USD" size="xs">
            <Info aria-hidden className="size-[var(--fw-icon-sm)]" />
          </IconButton>
        </Tooltip>
        <IconButton label="Close">
          <X aria-hidden className="size-[var(--fw-icon-sm)]" />
        </IconButton>
        <IconButton label="Account" size="md">
          <Moon aria-hidden className="size-[var(--fw-icon-md)]" />
        </IconButton>
        <Button variant="soon" size="sm" aria-disabled>
          <ArrowUpRight aria-hidden className="size-[var(--fw-icon-sm)]" />
          Send
        </Button>
      </KitGroup>
      <KitGroup title="Row button: a choice in a sheet">
        <div className="w-72">
          <RowButton aria-current>
            <Moon aria-hidden className="size-[var(--fw-icon-md)]" />
            <span className="min-w-0 flex-1 truncate">Personal</span>
          </RowButton>
          <RowButton>
            <Landmark aria-hidden className="size-[var(--fw-icon-md)]" />
            <span className="min-w-0 flex-1 truncate">Merchant · Sample shop</span>
          </RowButton>
        </div>
      </KitGroup>
      <KitGroup title="Choice cards: one of several, or any number">
        <Form className="w-full max-w-xl" onSubmit={(event) => event.preventDefault()}>
          <div className="grid gap-3 sm:grid-cols-2">
            {["freelancer", "merchant"].map((value) => (
              <ChoiceCard
                key={value}
                type="radio"
                name="kit-kind"
                value={value}
                checked={cardChoice === value}
                onChange={() => setCardChoice(value)}
                icon={value === "merchant" ? Landmark : Moon}
                title={value === "merchant" ? "Merchant" : "Freelancer"}
                hint="Shown on invoices and receipts."
                tag={value === "merchant" ? <Badge>Business profile</Badge> : undefined}
              />
            ))}
          </div>
        </Form>
      </KitGroup>
    </>
  );
}
