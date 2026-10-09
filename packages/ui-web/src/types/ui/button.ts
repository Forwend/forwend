import type { ComponentPropsWithoutRef, ComponentType } from "react";
import type { BUTTON_SIZES, BUTTON_VARIANTS } from "../../constants/button";

export type ButtonVariant = (typeof BUTTON_VARIANTS)[keyof typeof BUTTON_VARIANTS];
export type ButtonSize = (typeof BUTTON_SIZES)[keyof typeof BUTTON_SIZES];

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export interface ActionButtonProps extends ComponentPropsWithoutRef<"button"> {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  /** Set when the action is not available yet; shown as the reason and the button does nothing. */
  disabledReason?: string;
  /** The page's main action: filled. */
  primary?: boolean;
}

export interface ButtonProps extends ComponentPropsWithoutRef<"button">, ButtonStyleOptions {
  loading?: boolean;
}
