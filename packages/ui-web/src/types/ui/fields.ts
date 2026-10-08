import type { ComponentPropsWithoutRef, ReactNode } from "react";

export interface TextFieldProps extends ComponentPropsWithoutRef<"input"> {
  label: string;
  hint?: string;
  error?: string;
}

export interface SelectFieldProps extends ComponentPropsWithoutRef<"select"> {
  label: string;
  hint?: string;
  children: ReactNode;
}

export interface CheckboxProps extends Omit<ComponentPropsWithoutRef<"input">, "type"> {
  label: string;
}

export interface SwitchProps {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}
