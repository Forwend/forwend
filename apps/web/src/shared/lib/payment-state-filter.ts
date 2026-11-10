import { PAYMENT_STATUS_ICONS, PAYMENT_STATUSES } from "@forwend/ui-web";
import { ListFilter } from "lucide-react";
import { type FilterGroup, filterGroup } from "@/shared/components/list-filters";
import { API_PAYMENT_STATES, PAYMENT_STATE_FILTERS } from "@/shared/constants/payment-state";
import { PAYMENT_STATE_COPY as COPY } from "@/shared/constants/payment-state-copy";
import { STATE_STATUS } from "@/shared/lib/payment-state";
import type { PaymentStateFilter as Filter } from "@/shared/types/payment-state";

/** The one status filter of every payment list: each state with the label and icon of its status pill (D-114). */
export function paymentStateGroup(
  value: Filter,
  onValueChange: (value: Filter) => void,
): FilterGroup {
  return filterGroup({
    label: COPY.status,
    value,
    onValueChange,
    options: [
      { value: PAYMENT_STATE_FILTERS.all, label: COPY.all, icon: ListFilter },
      ...Object.values(API_PAYMENT_STATES).map((state) => ({
        value: state,
        label: PAYMENT_STATUSES[STATE_STATUS[state]].label,
        icon: PAYMENT_STATUS_ICONS[STATE_STATUS[state]],
      })),
    ],
  });
}
