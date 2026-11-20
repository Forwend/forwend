"use client";

import { Calendar, DatePicker, type DateRange, DateRangePicker } from "@forwend/ui-web";
import { useState } from "react";
import { KitGroup } from "@/screens/kit/kit-section";

// A fixed day, so the kit shows the same months in every screenshot.
const SAMPLE_TODAY = "2026-10-13";
const SAMPLE_MONTH_LATER = "2026-11-13";
const isWeekend = (iso: string) => [0, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay());

export function DatesShowcase() {
  const [dueDate, setDueDate] = useState<string | null>("2026-11-02");
  const [period, setPeriod] = useState<DateRange>({ from: null, to: null });
  return (
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
  );
}
