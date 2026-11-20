import { useState } from "react";
import { CUSTOM_EXPIRY, EXPIRY_CHOICES } from "@/features/invoices/constants/invoices";
import { NEW_INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import {
  dueCheckoutDate,
  dueCheckoutTarget,
  expiryChoice,
} from "@/features/invoices/lib/new-invoice";
import type { Expiry } from "@/features/invoices/types/invoices";
import { formatDueDate } from "@/shared/lib/dates";

/** The day a timestamp falls on here, as YYYY-MM-DD. */
export const localDate = (time: number) => new Date(time).toLocaleDateString("en-CA");

/** The due date sets the close until the owner picks one; otherwise the store's default does. */
export function useCheckoutClose(defaultSeconds: number | undefined, onSet: () => void) {
  const [expiry, setExpiry] = useState<Expiry>(expiryChoice(defaultSeconds));
  const [closesOn, setClosesOn] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [closeBy, setCloseBy] = useState<"default" | "due" | "owner">("default");
  const today = localDate(Date.now());
  // A close before the due date plus the grace days holds a late client's payment for them.
  const closeDay =
    expiry === CUSTOM_EXPIRY ? closesOn : localDate(Date.now() + EXPIRY_CHOICES[expiry] * 1000);
  const dueTarget = dueDate ? dueCheckoutTarget(dueDate) : null;
  const own = () => {
    setCloseBy("owner");
    onSet();
  };
  return {
    expiry,
    closesOn,
    dueDate,
    today,
    followsDue: closeBy === "due",
    early: dueTarget && closeDay && closeDay < dueTarget ? dueTarget : null, // the due date's close, when later
    closes:
      expiry === CUSTOM_EXPIRY ? (closesOn ? formatDueDate(closesOn) : "") : COPY.expiry[expiry],
    pickExpiry: (value: Expiry) => {
      setExpiry(value);
      own();
    },
    pickClosesOn: (iso: string | null) => {
      setClosesOn(iso);
      own();
    },
    pickTime: own,
    pickDueDate: (iso: string | null) => {
      setDueDate(iso);
      // An empty Custom date has nothing of the owner's to keep, so the due date fills it too.
      if (iso && (closeBy !== "owner" || (expiry === CUSTOM_EXPIRY && !closesOn))) {
        setExpiry(CUSTOM_EXPIRY);
        setClosesOn(dueCheckoutDate(iso, today));
        setCloseBy("due");
        onSet();
      } else if (!iso && closeBy === "due") {
        setExpiry(expiryChoice(defaultSeconds));
        setClosesOn(null);
        setCloseBy("default");
      }
    },
    pickDefault: (seconds: number | undefined) => {
      if (closeBy === "default") setExpiry(expiryChoice(seconds));
    },
  };
}

export type CheckoutClose = ReturnType<typeof useCheckoutClose>;
