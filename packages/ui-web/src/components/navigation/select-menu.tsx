"use client";

import { ChevronDown } from "lucide-react";
import type { ComponentType } from "react";
import { cx } from "../../lib/cx";
import { Button } from "../buttons/button";
import {
  Menu,
  MenuContent,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "../overlays/menu";

export interface SelectMenuOption<T extends string> {
  value: T;
  label: string;
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

export interface SelectMenuProps<T extends string> {
  /** What is chosen, such as "Status": it heads the menu and starts the button's accessible name. */
  label: string;
  options: readonly SelectMenuOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
}

/**
 * One choice from a list too long for a segmented control (a list's status filter): a button that shows the choice
 * with its icon, opening a menu of every option. The label shows beside the choice from small screens up.
 */
export function SelectMenu<T extends string>({
  label,
  options,
  value,
  onValueChange,
  className,
}: SelectMenuProps<T>) {
  const chosen = options.find((option) => option.value === value) ?? options[0];
  const Icon = chosen?.icon;
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button
          variant="secondary"
          aria-label={`${label}: ${chosen?.label ?? ""}`}
          className={cx("gap-2 pr-3 pl-3.5", className)}
        >
          {Icon ? <Icon aria-hidden className="size-[var(--fw-icon-sm)] text-muted" /> : null}
          <span className="text-muted max-sm:sr-only">{label}</span>
          <span>{chosen?.label}</span>
          <ChevronDown aria-hidden className="size-[var(--fw-icon-sm)] text-muted" />
        </Button>
      </MenuTrigger>
      <MenuContent align="end" className="min-w-48">
        <MenuLabel>{label}</MenuLabel>
        <MenuRadioGroup value={value} onValueChange={(next) => onValueChange(next as T)}>
          {options.map(({ value: option, label: optionLabel, icon: OptionIcon }) => (
            <MenuRadioItem key={option} value={option}>
              <span className="flex items-center gap-3">
                {OptionIcon ? (
                  <OptionIcon
                    aria-hidden
                    className="size-[var(--fw-icon-sm)] shrink-0 text-muted"
                  />
                ) : null}
                {optionLabel}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}
