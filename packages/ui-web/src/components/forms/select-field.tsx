"use client";

import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { useDialogContainer } from "../../hooks/use-dialog-container";
import { cx } from "../../lib/cx";
import { FIELD_CONTROL_CLASSES, OPTION_ROW_CLASSES } from "./field-classes";
import { FieldMessage, fieldMessageId } from "./field-message";

const PAGE_SCROLL_KEYS = [" ", "PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown"];

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  icon?: ReactNode;
}

export interface SelectFieldProps {
  label: string;
  hideLabel?: boolean;
  options: readonly SelectOption[];
  hint?: string;
  error?: string;
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function SelectField({
  label,
  hideLabel,
  options,
  hint,
  error,
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
  const describedBy = fieldMessageId(fieldId, error, hint);
  const [dialog, trigger] = useDialogContainer();
  // The page keeps its scrollbar while the list is open: keys the list left would scroll the page.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const hold = (event: KeyboardEvent) => {
      if (PAGE_SCROLL_KEYS.includes(event.key)) event.preventDefault();
    };
    window.addEventListener("keydown", hold);
    return () => window.removeEventListener("keydown", hold);
  }, [open]);
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      {/* A <label for> does not name a button-based combobox, so link it with aria-labelledby. */}
      <label
        id={`${fieldId}-label`}
        htmlFor={fieldId}
        className={cx("text-sm font-medium text-ink", hideLabel && "sr-only")}
      >
        {label}
      </label>
      <RadixSelect.Root
        name={name}
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        onOpenChange={setOpen}
        disabled={disabled}
      >
        <RadixSelect.Trigger
          ref={trigger}
          id={fieldId}
          aria-labelledby={`${fieldId}-label`}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cx(
            FIELD_CONTROL_CLASSES,
            "group flex items-center justify-between gap-3 text-left data-[placeholder]:text-subtle data-[state=open]:border-field-focus data-[state=open]:ring-2 data-[state=open]:ring-field-ring",
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
        <RadixSelect.Portal container={dialog}>
          <RadixSelect.Content
            position="popper"
            sideOffset={6}
            className="z-[var(--fw-z-overlay)] max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] origin-[var(--radix-select-content-transform-origin)] overflow-hidden rounded-md border border-line bg-surface p-1 text-ink shadow-lg data-[side=bottom]:[--fw-pop-y:-4px] motion-safe:data-[state=open]:animate-[fw-pop-in_var(--fw-duration-base)_var(--fw-ease-out)]"
          >
            <RadixSelect.Viewport>
              {options.map((option) => (
                <RadixSelect.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className={cx(
                    OPTION_ROW_CLASSES,
                    "data-[disabled]:cursor-not-allowed data-[disabled]:text-subtle data-[highlighted]:bg-surface-2 data-[state=checked]:font-medium",
                  )}
                >
                  <RadixSelect.ItemText>
                    {option.icon ? (
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="flex shrink-0">{option.icon}</span>
                        <span className="truncate">{option.label}</span>
                      </span>
                    ) : (
                      option.label
                    )}
                  </RadixSelect.ItemText>
                  <RadixSelect.ItemIndicator>
                    <Check aria-hidden className="size-[var(--fw-icon-sm)] text-accent" />
                  </RadixSelect.ItemIndicator>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
      <FieldMessage fieldId={fieldId} error={error} hint={hint} />
    </div>
  );
}
