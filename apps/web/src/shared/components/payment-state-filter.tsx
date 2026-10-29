"use client";

import { PAYMENT_STATUS_ICONS, PAYMENT_STATUSES, SelectMenu } from "@forwend/ui-web";
import { ListFilter } from "lucide-react";
import { API_PAYMENT_STATES, PAYMENT_STATE_FILTERS } from "@/shared/constants/payment-state";
import { PAYMENT_STATE_COPY as COPY } from "@/shared/constants/payment-state-copy";
import { STATE_STATUS } from "@/shared/lib/payment-state";
import type { PaymentStateFilter as Filter } from "@/shared/types/payment-state";

export interface PaymentStateFilterProps {
  value: Filter;
  onValueChange: (value: Filter) => void;
}

/** The one status filter of every payment list: each state with the label and icon of its status pill (D-114). */
export function PaymentStateFilter({ value, onValueChange }: PaymentStateFilterProps) {
  return (
    <SelectMenu
      label={COPY.status}
      value={value}
      onValueChange={onValueChange}
      options={[
        { value: PAYMENT_STATE_FILTERS.all, label: COPY.all, icon: ListFilter },
        ...Object.values(API_PAYMENT_STATES).map((state) => ({
          value: state,
          label: PAYMENT_STATUSES[STATE_STATUS[state]].label,
          icon: PAYMENT_STATUS_ICONS[STATE_STATUS[state]],
        })),
      ]}
    />
  );
}
