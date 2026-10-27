"use client";

import { SelectMenu } from "@forwend/ui-web";
import { Ban, Circle, CircleCheck, Clock, ListFilter, Wallet } from "lucide-react";
import { STATUS_FILTERS } from "@/features/activity/constants/activity";
import { ACTIVITY_COPY } from "@/features/activity/constants/activity-copy";
import type { StatusFilter as Status } from "@/features/activity/types/activity";

// The same icons as the status pills and bell events.
const ICONS = {
  all: ListFilter,
  open: Circle,
  confirming: Clock,
  paid: CircleCheck,
  settled: Wallet,
  expired: Clock,
  canceled: Ban,
} as const satisfies Record<Status, unknown>;

export interface StatusFilterProps {
  value: Status;
  onValueChange: (value: Status) => void;
}

export function StatusFilter({ value, onValueChange }: StatusFilterProps) {
  return (
    <SelectMenu
      label={ACTIVITY_COPY.filterLabel}
      value={value}
      onValueChange={onValueChange}
      options={Object.values(STATUS_FILTERS).map((status) => ({
        value: status,
        label: ACTIVITY_COPY.filters[status],
        icon: ICONS[status],
      }))}
    />
  );
}
