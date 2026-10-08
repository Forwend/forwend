import type { ComponentPropsWithoutRef } from "react";
import type { BUTTON_VARIANTS } from "../../constants/button";

export type ButtonVariant = (typeof BUTTON_VARIANTS)[keyof typeof BUTTON_VARIANTS];

export interface ButtonProps extends ComponentPropsWithoutRef<"button"> {
  variant?: ButtonVariant;
}
