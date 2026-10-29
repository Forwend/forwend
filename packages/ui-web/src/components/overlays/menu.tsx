"use client";

import * as RadixMenu from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { useRef } from "react";
import { cx } from "../../lib/cx";

export type MenuContentProps = RadixMenu.DropdownMenuContentProps;

export type MenuItemProps = RadixMenu.DropdownMenuItemProps;

export type MenuRadioItemProps = RadixMenu.DropdownMenuRadioItemProps;

export type MenuCheckboxItemProps = RadixMenu.DropdownMenuCheckboxItemProps;

// Menus close at once: a fade-out would hand focus back to the trigger late, and so close a menu opened again in
// the meantime.

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
  onCloseAutoFocus,
  onPointerDown,
  onPointerDownOutside,
  onKeyDown,
  ...props
}: MenuContentProps) {
  // Closed by a pointer, focus stays where the pointer left it: returning it to the trigger would draw the
  // keyboard focus ring on a control the person only clicked. A keyboard close still returns focus.
  const byPointer = useRef(false);
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content
        align={align}
        side={side}
        onPointerDown={(event) => {
          byPointer.current = true;
          onPointerDown?.(event);
        }}
        onPointerDownOutside={(event) => {
          byPointer.current = true;
          onPointerDownOutside?.(event);
        }}
        onKeyDown={(event) => {
          byPointer.current = false;
          onKeyDown?.(event);
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          if (byPointer.current && !event.defaultPrevented) event.preventDefault();
          byPointer.current = false;
        }}
        sideOffset={8}
        collisionPadding={12}
        className={cx(
          "z-[var(--fw-z-overlay)] min-w-[var(--radix-dropdown-menu-trigger-width)] max-w-[calc(100vw-2rem)] rounded-md border border-line bg-surface p-1 text-ink shadow-lg",
          "origin-[var(--radix-dropdown-menu-content-transform-origin)] data-[side=bottom]:[--fw-pop-y:-4px] motion-safe:data-[state=open]:animate-[fw-pop-in_var(--fw-duration-base)_var(--fw-ease-out)]",
          className,
        )}
        {...props}
      />
    </RadixMenu.Portal>
  );
}

const ITEM =
  "flex min-h-9 cursor-pointer items-center gap-2.5 rounded-sm px-2.5 text-sm pointer-coarse:min-h-11 outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:text-subtle data-[highlighted]:bg-surface-2";

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

/** The menu stays open when the setting changes. */
export function MenuCheckboxItem({
  className,
  children,
  onSelect,
  ...props
}: MenuCheckboxItemProps) {
  return (
    <RadixMenu.CheckboxItem
      className={cx(ITEM, "group", className)}
      onSelect={(event) => {
        event.preventDefault();
        onSelect?.(event);
      }}
      {...props}
    >
      <span className="flex min-w-0 flex-1 items-center gap-3">{children}</span>
      <span
        aria-hidden
        className="relative inline-flex h-5 w-9 shrink-0 rounded-pill border border-line-strong bg-surface-2 transition-colors duration-[var(--fw-duration-base)] group-data-[state=checked]:border-transparent group-data-[state=checked]:bg-accent"
      >
        <span className="absolute top-0.5 left-0.5 size-3.5 rounded-pill bg-subtle shadow-sm transition-[translate,background-color] duration-[var(--fw-duration-base)] ease-out group-data-[state=checked]:translate-x-4 group-data-[state=checked]:bg-surface dark:group-data-[state=checked]:bg-ink" />
      </span>
    </RadixMenu.CheckboxItem>
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
