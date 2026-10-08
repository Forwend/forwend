import { BUTTON_VARIANTS } from "../constants/button";
import type { ButtonProps } from "../types/ui/button";

// Placeholder. F005 restyles it with the design tokens.
export function Button({
  variant = BUTTON_VARIANTS.primary,
  type = "button",
  ...props
}: ButtonProps) {
  return <button type={type} data-variant={variant} {...props} />;
}
