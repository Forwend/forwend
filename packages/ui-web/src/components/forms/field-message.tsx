import { cx } from "../../lib/cx";

/** The id a field's control names in aria-describedby: its error's, else its hint's. */
export function fieldMessageId(fieldId: string, error?: string, hint?: string): string | undefined {
  return error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
}

interface FieldMessageProps {
  fieldId: string;
  error?: string;
  hint?: string;
  className?: string;
}

/** The line under a field: its error, or else its hint. */
export function FieldMessage({ fieldId, error, hint, className }: FieldMessageProps) {
  if (error) {
    return (
      <p id={`${fieldId}-error`} role="alert" className={cx("text-sm text-danger", className)}>
        {error}
      </p>
    );
  }
  if (hint) {
    return (
      <p id={`${fieldId}-hint`} className={cx("text-sm text-muted", className)}>
        {hint}
      </p>
    );
  }
  return null;
}
