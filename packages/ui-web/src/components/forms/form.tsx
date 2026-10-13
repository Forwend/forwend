import type { ComponentPropsWithRef } from "react";
import { cx } from "../../lib/cx";

const GAPS = { sm: "gap-2", md: "gap-5", lg: "gap-6" } as const;

export interface FormProps extends ComponentPropsWithRef<"form"> {
  /** Space between groups: sm for one field with its button, lg between fieldsets. */
  gap?: keyof typeof GAPS;
}

/** A form that validates itself: the browser's own bubbles are off, so errors show beside their field. */
export function Form({ gap = "lg", className, children, ...props }: FormProps) {
  return (
    <form noValidate className={cx("flex flex-col", GAPS[gap], className)} {...props}>
      {children}
    </form>
  );
}
