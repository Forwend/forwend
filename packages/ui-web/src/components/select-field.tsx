"use client";

import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { useId } from "react";
import { FIELD_CONTROL_CLASSES } from "../constants/field";
import { cx } from "../lib/cx";
import type { SelectFieldProps } from "../types/ui/fields";

// A custom listbox (Radix Select): keyboard and screen-reader support, styled with tokens.
export function SelectField({
  label,
  options,
  hint,
  id,
  name,
  value,
  defaultValue,
  onValueChange,
  placeholder = "Choose…",
  disabled,
  className,
}: SelectFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      {/* A <label for> does not name a button-based combobox, so link it with aria-labelledby. */}
      <label id={`${fieldId}-label`} htmlFor={fieldId} className="text-sm font-medium text-ink">
        {label}
      </label>
      <RadixSelect.Root
        name={name}
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        disabled={disabled}
      >
        <RadixSelect.Trigger
          id={fieldId}
          aria-labelledby={`${fieldId}-label`}
          aria-describedby={hint ? `${fieldId}-hint` : undefined}
          className={cx(
            FIELD_CONTROL_CLASSES,
            "group flex items-center justify-between gap-3 text-left data-[placeholder]:text-subtle data-[state=open]:border-focus data-[state=open]:ring-4 data-[state=open]:ring-[color-mix(in_oklab,var(--fw-focus)_22%,transparent)]",
          )}
        >
          <RadixSelect.Value placeholder={placeholder} />
          <RadixSelect.Icon>
            <ChevronDown
              aria-hidden
              className="size-[var(--fw-icon-sm)] text-subtle transition-transform duration-[var(--fw-duration-fast)] group-data-[state=open]:rotate-180"
            />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content
            position="popper"
            sideOffset={6}
            className="z-[var(--fw-z-overlay)] max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-line bg-surface p-1 text-ink shadow-lg"
          >
            <RadixSelect.Viewport>
              {options.map((option) => (
                <RadixSelect.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-sm px-3 py-2 text-base outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:text-subtle data-[highlighted]:bg-surface-2 data-[state=checked]:font-medium"
                >
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                  <RadixSelect.ItemIndicator>
                    <Check aria-hidden className="size-[var(--fw-icon-sm)] text-accent" />
                  </RadixSelect.ItemIndicator>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
      {hint ? (
        <p id={`${fieldId}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
