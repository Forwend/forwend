"use client";

import { CalendarDays, X } from "lucide-react";
import { useId } from "react";
import { cx } from "../../../lib/cx";
import { IconButton } from "../../buttons/icon-button";
import { FIELD_CONTROL_CLASSES } from "../field-classes";
import { FieldMessage, fieldMessageId } from "../field-message";
import { Calendar, type CalendarProps } from "./calendar";
import { toTime } from "./iso-date";
import { useDatePopover } from "./use-date-popover";

export interface DatePickerProps extends Pick<CalendarProps, "min" | "max" | "isDisabled"> {
  label: string;
  value: string | null;
  onChange: (iso: string | null) => void;
  name?: string;
  hint?: string;
  error?: string;
  clearLabel?: string;
  className?: string;
}

const SHOWN = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });

export function DatePicker({
  label,
  value,
  onChange,
  name,
  hint,
  error,
  clearLabel,
  min,
  max,
  isDisabled,
  className,
}: DatePickerProps) {
  const id = useId();
  const { open, toggle, close, onKeyDown, root, trigger, popover, position } = useDatePopover();

  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <span id={`${id}-label`} className="text-sm font-medium text-ink">
        {label}
      </span>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: catches Escape from the trigger and the calendar inside */}
      <div ref={root} className="relative" onKeyDown={onKeyDown}>
        <div className="flex items-center gap-2">
          <button
            ref={trigger}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-labelledby={`${id}-label ${id}-value`}
            aria-invalid={error ? true : undefined}
            aria-describedby={fieldMessageId(id, error, hint)}
            onClick={toggle}
            className={cx(
              FIELD_CONTROL_CLASSES,
              "flex items-center justify-between gap-3 text-left",
            )}
          >
            <span id={`${id}-value`} className={value ? "text-ink" : "text-subtle"}>
              {value ? SHOWN.format(toTime(value)) : "Choose a date"}
            </span>
            <CalendarDays aria-hidden className="size-[var(--fw-icon-md)] shrink-0 text-muted" />
          </button>
          {clearLabel && value ? (
            <IconButton label={clearLabel} onClick={() => onChange(null)}>
              <X aria-hidden className="size-[var(--fw-icon-sm)]" />
            </IconButton>
          ) : null}
        </div>
        {open ? (
          <div
            ref={popover}
            role="dialog"
            aria-labelledby={`${id}-label`}
            style={position}
            className="z-[var(--fw-z-overlay)] max-w-[calc(100vw-1rem)] rounded-md border border-line bg-surface p-3 text-ink shadow-lg"
          >
            <Calendar
              label={label}
              value={value}
              min={min}
              max={max}
              isDisabled={isDisabled}
              autoFocus
              onChange={(iso) => {
                onChange(iso);
                close();
              }}
            />
          </div>
        ) : null}
      </div>
      {name ? <input type="hidden" name={name} value={value ?? ""} /> : null}
      <FieldMessage fieldId={id} error={error} hint={hint} />
    </div>
  );
}
