"use client";

import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { useId } from "react";
import { cx } from "../lib/cx";
import type {
  CheckboxProps,
  SelectFieldProps,
  SwitchProps,
  TextFieldProps,
} from "../types/ui/fields";

const CONTROL =
  "h-11 w-full rounded-md border border-line-strong bg-surface px-3.5 text-base text-ink shadow-sm transition-[border-color,box-shadow] duration-[var(--fw-duration-fast)] ease-out placeholder:text-subtle hover:border-subtle focus-visible:border-focus focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color-mix(in_oklab,var(--fw-focus)_22%,transparent)] disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-2 disabled:text-subtle aria-[invalid=true]:border-danger";

export function TextField({ label, hint, error, id, className, ...props }: TextFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={fieldId} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={CONTROL}
        {...props}
      />
      {error ? (
        <p id={`${fieldId}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

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
            CONTROL,
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

export function Checkbox({ label, id, className, ...props }: CheckboxProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <label
      htmlFor={fieldId}
      className={cx("inline-flex cursor-pointer items-center gap-2.5 text-sm", className)}
    >
      <input
        id={fieldId}
        type="checkbox"
        className="size-[var(--fw-icon-md)] rounded-sm accent-[var(--fw-accent)]"
        {...props}
      />
      {label}
    </label>
  );
}

export function Switch({ label, checked, onCheckedChange, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className="group inline-flex items-center gap-3 text-sm disabled:cursor-not-allowed disabled:text-subtle"
    >
      <span
        className={cx(
          "relative inline-flex h-6 w-11 shrink-0 rounded-pill border transition-colors duration-[var(--fw-duration-base)] ease-out",
          checked ? "border-transparent bg-accent" : "border-line-strong bg-surface-2",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 size-4.5 rounded-pill bg-surface shadow-sm transition-transform duration-[var(--fw-duration-base)] ease-out",
            checked ? "translate-x-5.5" : "translate-x-0.5",
          )}
        />
      </span>
      {label}
    </button>
  );
}
