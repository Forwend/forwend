"use client";

import {
  AmountField,
  Button,
  CAPTURE_STATUS,
  Checkbox,
  CodeInput,
  ComboboxField,
  EmailCapture,
  SelectField,
  Switch,
  SwitchCard,
  TextAreaField,
  TextField,
} from "@forwend/ui-web";
import { Power, Repeat } from "lucide-react";
import { useState } from "react";
import { CTA } from "@/features/waitlist/constants/waitlist";
import { KitGroup } from "@/screens/kit/kit-section";

const noop = () => {};

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

export function FieldsShowcase() {
  const [on, setOn] = useState(true);
  const [weekly, setWeekly] = useState(false);
  const [reusable, setReusable] = useState(true);
  const [linkOn, setLinkOn] = useState(false);
  const [code, setCode] = useState("826");
  return (
    <>
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
      <KitGroup title="Amount field: empty, typed, error; inline text field with an error">
        <div className="grid w-full max-w-xl gap-4">
          <AmountField label="Amount" unit="USD" placeholder="0.00" />
          <AmountField label="Amount" unit="USD" defaultValue="12.50" />
          <AmountField label="Amount" unit="USDC" placeholder="0" bare />
          <AmountField
            label="Amount"
            unit="USDC"
            defaultValue="25.50"
            bare
            error="That is more than this wallet holds."
          />
          <AmountField
            label="Amount"
            unit="USD"
            defaultValue="12.505"
            error="Enter an amount, such as 12.50."
          />
          <TextField
            label="Payment limit"
            defaultValue="0"
            error="Enter a whole number from 1 to 1,000,000."
            inline
          />
        </div>
      </KitGroup>
      <KitGroup title="Switch card: on with the field it opens, off, disabled">
        <div className="grid w-full max-w-xl gap-4">
          <SwitchCard
            icon={<Repeat />}
            title="Reusable"
            description={
              reusable ? "Pay multiple times with this link." : "One payment, then the link closes."
            }
            checked={reusable}
            onCheckedChange={setReusable}
          >
            <TextField
              label="Payment limit"
              placeholder="No limit"
              inputMode="numeric"
              hint="Open checkouts count toward it."
              inline
            />
          </SwitchCard>
          <SwitchCard
            icon={<Power />}
            title="The link is on"
            description="Off, no one can start a new purchase."
            checked={linkOn}
            onCheckedChange={setLinkOn}
          />
          <SwitchCard
            title="Send events"
            description="Your role can't change this."
            checked
            onCheckedChange={noop}
            disabled
          />
        </div>
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
    </>
  );
}

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
