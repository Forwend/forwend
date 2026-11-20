"use client";

import { SearchField, SegmentedControl, SelectMenu } from "@forwend/ui-web";
import { Ban, Circle, CircleCheck, Clock, ListFilter, Wallet } from "lucide-react";
import { useState } from "react";
import { KitGroup } from "@/screens/kit/kit-section";

const noop = () => {};

export function ListControlsShowcase() {
  const [range, setRange] = useState("1M");
  const [status, setStatus] = useState("All");
  const [search, setSearch] = useState("");
  return (
    <>
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
            { value: "Waiting", label: "Waiting", icon: Circle },
            { value: "Paid", label: "Paid", icon: CircleCheck },
            { value: "In wallet", label: "In wallet", icon: Wallet },
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
    </>
  );
}
