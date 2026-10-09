"use client";

import * as RadixMenu from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { cx } from "../../lib/cx";

export type MenuContentProps = RadixMenu.DropdownMenuContentProps;

export type MenuItemProps = RadixMenu.DropdownMenuItemProps;

export type MenuRadioItemProps = RadixMenu.DropdownMenuRadioItemProps;

// A dropdown menu on Radix (keyboard, focus and screen-reader roles), styled with tokens. It rises from the edge it
// opens on; reduced motion drops the movement.

/** Not modal: the page stays readable behind an open menu; Escape and a click outside still close it. */
export function Menu(props: RadixMenu.DropdownMenuProps) {
  return <RadixMenu.Root modal={false} {...props} />;
}

export const MenuTrigger = RadixMenu.Trigger;

export const MenuGroup = RadixMenu.Group;

export const MenuRadioGroup = RadixMenu.RadioGroup;

export function MenuContent({
  className,
  align = "start",
  side = "bottom",
  ...props
}: MenuContentProps) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content
        align={align}
        side={side}
        sideOffset={8}
        collisionPadding={12}
        className={cx(
          "z-50 min-w-[var(--radix-dropdown-menu-trigger-width)] max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface p-1.5 text-ink shadow-lg",
          "origin-[var(--radix-dropdown-menu-content-transform-origin)] motion-safe:data-[state=open]:animate-[fw-pop-in_var(--fw-duration-base)_var(--fw-ease-out)]",
          className,
        )}
        {...props}
      />
    </RadixMenu.Portal>
  );
}

const ITEM =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 text-sm outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:text-subtle data-[highlighted]:bg-surface-2";

export function MenuItem({ className, ...props }: MenuItemProps) {
  return <RadixMenu.Item className={cx(ITEM, className)} {...props} />;
}

export function MenuRadioItem({ className, children, ...props }: MenuRadioItemProps) {
  return (
    <RadixMenu.RadioItem className={cx(ITEM, className)} {...props}>
      <span className="min-w-0 flex-1">{children}</span>
      <RadixMenu.ItemIndicator>
        <Check aria-hidden className="size-[var(--fw-icon-md)] text-ink" />
      </RadixMenu.ItemIndicator>
    </RadixMenu.RadioItem>
  );
}

export function MenuLabel({ className, ...props }: RadixMenu.DropdownMenuLabelProps) {
  return (
    <RadixMenu.Label className={cx("px-3 pt-2 pb-1 text-xs text-muted", className)} {...props} />
  );
}

export function MenuSeparator({ className, ...props }: RadixMenu.DropdownMenuSeparatorProps) {
  return <RadixMenu.Separator className={cx("my-1.5 h-px bg-line", className)} {...props} />;
}
