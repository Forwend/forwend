"use client";

import {
  Accordion,
  ActionButton,
  Badge,
  BUTTON_SIZES,
  BUTTON_VARIANTS,
  Button,
  CAPTURE_STATUS,
  Calendar,
  Checkbox,
  ChoiceCard,
  CodeBlock,
  CodeInput,
  ComboboxField,
  DatePicker,
  type DateRange,
  DateRangePicker,
  Dialog,
  EmailCapture,
  EmptyState,
  Form,
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  NavPill,
  PANEL_TONES,
  Panel,
  RowButton,
  SearchField,
  SegmentedControl,
  SelectField,
  SelectMenu,
  Sheet,
  Skeleton,
  Stepper,
  Switch,
  Tabs,
  TextAreaField,
  TextField,
  TONES,
  Toast,
  ToastProvider,
  Tooltip,
  useToast,
} from "@forwend/ui-web";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  Circle,
  CircleCheck,
  Clock,
  Info,
  Landmark,
  ListFilter,
  Moon,
  Plus,
  Wallet,
  X,
} from "lucide-react";
import { useState } from "react";
import { CTA } from "@/features/waitlist/constants/waitlist";
import { KitGroup } from "@/screens/kit/kit-section";

// A fixed day, so the kit shows the same months in every screenshot.
const SAMPLE_TODAY = "2026-10-13";
const SAMPLE_MONTH_LATER = "2026-11-13";
const isWeekend = (iso: string) => [0, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay());

const noop = () => {};

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

const SAMPLE_COUNTRIES = [
  { value: "", label: "No country" },
  { value: "CI", label: "Côte d'Ivoire" },
  { value: "CW", label: "Curaçao" },
  { value: "DE", label: "Germany" },
  { value: "NL", label: "Netherlands" },
  { value: "BQ", label: "Caribbean Netherlands" },
  { value: "GB", label: "United Kingdom" },
  { value: "US", label: "United States" },
];

const SAMPLE_CLIENTS = [
  { value: "1", label: "Brightline Studio", detail: "ap@brightline.example" },
  { value: "2", label: "Harbour & Co", detail: "finance@harbour.example" },
  { value: "3", label: "Studio Lumen", detail: "billing@lumen.example" },
];

function ComboboxDemo() {
  const [country, setCountry] = useState("DE");
  const [client, setClient] = useState("");
  return (
    <>
      <ComboboxField
        label="Country"
        options={SAMPLE_COUNTRIES}
        value={country}
        onValueChange={setCountry}
        searchLabel="Search countries"
        hint="Type to search: “cote” finds Côte d'Ivoire."
      />
      <ComboboxField
        label="Saved client"
        options={SAMPLE_CLIENTS}
        value={client}
        onValueChange={setClient}
        placeholder="Fill in from a saved client"
        searchLabel="Search clients"
      />
      <ComboboxField
        label="Billing country"
        options={SAMPLE_COUNTRIES.filter((c) => c.value)}
        placeholder="Choose a country"
        value=""
        onValueChange={() => {}}
        error="Choose a country."
      />
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

export function ComponentsShowcase() {
  const [step, setStep] = useState(2);
  const [on, setOn] = useState(true);
  const [weekly, setWeekly] = useState(false);
  const [menuChoice, setMenuChoice] = useState("personal");
  const [cardChoice, setCardChoice] = useState("merchant");
  const [menuDark, setMenuDark] = useState(false);
  const [range, setRange] = useState("1M");
  const [status, setStatus] = useState("All");
  const [search, setSearch] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dueDate, setDueDate] = useState<string | null>("2026-11-02");
  const [period, setPeriod] = useState<DateRange>({ from: null, to: null });
  const [code, setCode] = useState("826");
  return (
    <div className="flex flex-col gap-10">
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
              />
            ))}
          </div>
        </Form>
      </KitGroup>
      <KitGroup title="Segmented control: sm beside a chart, md in a toolbar; too narrow, it scrolls and fades">
        <SegmentedControl
          label="Chart range"
          value={range}
          onValueChange={setRange}
          size="sm"
          options={["1W", "1M", "3M", "1Y"].map((value) => ({ value, label: value }))}
        />
        <div className="w-72">
          <SegmentedControl
            label="Status"
            value={status}
            onValueChange={setStatus}
            className="w-full"
            options={["All", "Open", "Paid", "Settled", "Expired", "Canceled"].map((value) => ({
              value,
              label: value,
            }))}
          />
        </div>
      </KitGroup>
      <KitGroup title="Select menu: a longer choice beside a list's search, each option with its icon">
        <SelectMenu
          label="Status"
          value={status}
          onValueChange={setStatus}
          options={[
            { value: "All", label: "All", icon: ListFilter },
            { value: "Open", label: "Open", icon: Circle },
            { value: "Paid", label: "Paid", icon: CircleCheck },
            { value: "Settled", label: "Settled", icon: Wallet },
            { value: "Expired", label: "Expired", icon: Clock },
            { value: "Canceled", label: "Canceled", icon: Ban },
          ]}
        />
      </KitGroup>
      <KitGroup title="Search field: filters a list in its toolbar">
        <SearchField
          label="Search invoices"
          value={search}
          onValueChange={setSearch}
          placeholder="Search number, client or title"
          className="w-72"
        />
        <SearchField
          label="Search transactions"
          value="0x7a1c"
          onValueChange={noop}
          placeholder="Search address, hash or token"
          className="w-72"
        />
      </KitGroup>
      <KitGroup title="Menu and sheet">
        <Menu>
          <MenuTrigger asChild>
            <Button variant={BUTTON_VARIANTS.secondary}>Open menu</Button>
          </MenuTrigger>
          <MenuContent>
            <MenuLabel>Profiles</MenuLabel>
            <MenuRadioGroup value={menuChoice} onValueChange={setMenuChoice}>
              <MenuRadioItem value="personal">Personal</MenuRadioItem>
              <MenuRadioItem value="merchant">Merchant · Studio Lumen</MenuRadioItem>
            </MenuRadioGroup>
            <MenuSeparator />
            <MenuItem>
              <Plus aria-hidden className="size-[var(--fw-icon-md)]" />
              New profile
            </MenuItem>
            <MenuItem disabled>Unavailable item</MenuItem>
            <MenuSeparator />
            <MenuCheckboxItem checked={menuDark} onCheckedChange={setMenuDark}>
              <Moon aria-hidden className="size-[var(--fw-icon-md)]" />
              Dark mode
            </MenuCheckboxItem>
          </MenuContent>
        </Menu>
        <Button variant={BUTTON_VARIANTS.secondary} onClick={() => setSheetOpen(true)}>
          Open sheet
        </Button>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen} title="Receive">
          <p className="text-muted">A bottom sheet on phones, a centered panel from sm up.</p>
        </Sheet>
      </KitGroup>
      <KitGroup title="Dates">
        <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-3">
          <DatePicker
            label="Due date (optional)"
            value={dueDate}
            onChange={setDueDate}
            clearLabel="Clear due date"
            hint="Shown to the client."
          />
          <DatePicker
            label="Weekdays in the next month"
            value={null}
            onChange={() => {}}
            min={SAMPLE_TODAY}
            max={SAMPLE_MONTH_LATER}
            isDisabled={isWeekend}
          />
          <DatePicker
            label="Checkout closes on"
            value={null}
            onChange={() => {}}
            error="Pick a day within the next year."
          />
        </div>
        <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-3">
          <DateRangePicker
            label="Period"
            value={period}
            onChange={setPeriod}
            note="Days are in UTC."
            clearLabel="Clear period"
          />
          <DateRangePicker
            label="Period, chosen"
            value={{ from: "2026-10-01", to: "2026-10-31" }}
            onChange={() => {}}
          />
          <DateRangePicker
            label="Statement period"
            value={{ from: "2026-10-01", to: null }}
            onChange={() => {}}
            error="Choose both days: a statement covers a period."
          />
        </div>
        <div className="rounded-lg border border-line bg-surface p-3">
          <Calendar label="Calendar, with a chosen day" value="2026-10-21" onChange={() => {}} />
        </div>
      </KitGroup>
      <KitGroup title="Fields">
        <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-3">
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
          <TextField
            label="Email me the receipt"
            type="email"
            hint="Used for this receipt only."
            action={<Button variant="secondary">Send</Button>}
          />
          <SelectField
            label="Profile (label for screen readers only)"
            hideLabel
            defaultValue="personal"
            options={[
              { value: "personal", label: "Personal" },
              { value: "merchant", label: "Merchant · Studio Lumen" },
            ]}
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
          <SelectField
            label="Payout token"
            error="Choose the token your client pays in."
            options={[
              { value: "usdc", label: "USDC" },
              { value: "eurc", label: "EURC" },
            ]}
          />
        </div>
        <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-3">
          <ComboboxDemo />
        </div>
        <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-3">
          <TextAreaField label="Note to the client" hint="Shown on the pay page." />
          <TextAreaField
            label="Client address"
            defaultValue={"Brightline Studio\n12 Harbour Road"}
            error="Use at most 500 characters."
          />
        </div>
        <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-3">
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
        <Checkbox label="USDC on every network (some on)" mixed />
        <Switch label="Email me when a payment settles" checked={on} onCheckedChange={setOn} />
        <Switch label="Email me a weekly summary" checked={weekly} onCheckedChange={setWeekly} />
      </KitGroup>
      <KitGroup title="Email capture: idle, submitting, success, error">
        <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-2">
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
        {/* The page variant has no frame and fills its workspace; the dashed box stands in for the page. */}
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
    </div>
  );
}
