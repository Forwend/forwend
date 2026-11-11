"use client";

import {
  BUTTON_VARIANTS,
  Button,
  Dialog,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  TONES,
  useToast,
} from "@forwend/ui-web";
import { Ban, Ellipsis, ReceiptText, X } from "lucide-react";
import Link from "next/link";
import { type MouseEvent, useRef } from "react";
import { useExpireCheckoutMutation } from "@/features/checkout/api/checkout-api";
import { CHECKOUT_COPY as COPY } from "@/features/checkout/constants/checkout-copy";
import { APP_ROUTES } from "@/shared/config/routes";

const CONFLICT = 409;

export interface CheckoutActionsProps {
  profileId: string;
  /** The checkout session's id, which is its payment's id. */
  paymentId: string;
  /** Still open with nothing paid, so Cancel checkout shows. */
  cancelable: boolean;
  /** The live sale: its menu links the payment, and Cancel is a button of its own at the bar's start. The payment's
   * own page keeps both in its menu. */
  sale?: boolean;
  /** Once Cancel is done or comes too late, this menu may go: focus moves here. */
  onDone: () => void;
}

export function CheckoutActions({
  profileId,
  paymentId,
  cancelable,
  sale = false,
  onDone,
}: CheckoutActionsProps) {
  const [expire, { isLoading, isError }] = useExpireCheckoutMutation();
  const toast = useToast();
  // The dialog opens once the menu has closed, so the menu does not hand focus back to its trigger over the dialog.
  const chosen = useRef<(() => void) | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  if (!cancelable && !sale) return null;

  // The refetch that follows ends the cancel and removes the dialog, so it closes first: focus can then leave it.
  const confirm = async (event: MouseEvent<HTMLButtonElement>) => {
    const dialog = event.currentTarget.closest("dialog");
    try {
      await expire({ profileId, sessionId: paymentId }).unwrap();
      dialog?.close();
      toast({ tone: TONES.success, title: COPY.canceled });
      onDone();
    } catch (failure) {
      // Too late: money arrived meanwhile. Otherwise the dialog says so and stays.
      if ((failure as { status?: unknown }).status !== CONFLICT) return;
      dialog?.close();
      toast({ tone: TONES.warning, title: COPY.cancelFailed });
      onDone();
    }
  };

  const menu = (openCancel?: () => void) => (
    <Menu>
      <MenuTrigger asChild ref={trigger}>
        <IconButton label={COPY.moreActions} title={COPY.moreActions} size="md">
          <Ellipsis aria-hidden className="size-[var(--fw-icon-md)]" />
        </IconButton>
      </MenuTrigger>
      <MenuContent
        align="end"
        className="w-56"
        onCloseAutoFocus={(event) => {
          const open = chosen.current;
          if (!open) return;
          chosen.current = null;
          event.preventDefault();
          // A closed dialog gives focus back to what had it when it opened.
          trigger.current?.focus();
          open();
        }}
      >
        {sale ? (
          <MenuItem asChild>
            <Link href={`${APP_ROUTES.payments}/${paymentId}`}>
              <ReceiptText aria-hidden className="size-[var(--fw-icon-sm)]" />
              {COPY.openPayment}
            </Link>
          </MenuItem>
        ) : null}
        {sale && openCancel ? <MenuSeparator /> : null}
        {openCancel ? (
          <MenuItem
            className="text-danger data-[highlighted]:bg-danger-soft"
            onSelect={() => {
              chosen.current = openCancel;
            }}
          >
            <Ban aria-hidden className="size-[var(--fw-icon-sm)]" />
            {COPY.cancel}
          </MenuItem>
        ) : null}
      </MenuContent>
    </Menu>
  );

  return cancelable ? (
    <Dialog
      triggerLabel={COPY.cancel}
      title={COPY.cancelTitle}
      trigger={(open) =>
        sale ? (
          <>
            <Button variant={BUTTON_VARIANTS.ghost} onClick={open} className="order-first">
              <X aria-hidden className="size-[var(--fw-icon-sm)]" />
              {COPY.cancelSale}
            </Button>
            {menu()}
          </>
        ) : (
          menu(open)
        )
      }
    >
      <p>{COPY.cancelBody}</p>
      {isError ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {COPY.cancelError}
        </p>
      ) : null}
      <form method="dialog" className="mt-5 flex flex-wrap justify-end gap-2">
        <Button type="submit" variant={BUTTON_VARIANTS.secondary}>
          {COPY.keep}
        </Button>
        <Button
          type="button"
          variant={BUTTON_VARIANTS.danger}
          loading={isLoading}
          onClick={confirm}
        >
          {COPY.cancel}
        </Button>
      </form>
    </Dialog>
  ) : (
    menu()
  );
}
