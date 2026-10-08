import type { ComponentPropsWithoutRef } from "react";

export interface TextFieldProps extends ComponentPropsWithoutRef<"input"> {
  label: string;
  hint?: string;
  error?: string;
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectFieldProps {
  label: string;
  options: readonly SelectOption[];
  hint?: string;
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
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
