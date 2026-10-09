import type { ComponentPropsWithoutRef, ReactNode } from "react";
import type { PANEL_TONES } from "../../constants/panel";
import type { Tone } from "./tone";

export type PanelTone = (typeof PANEL_TONES)[keyof typeof PANEL_TONES];

export interface PanelProps extends ComponentPropsWithoutRef<"div"> {
  tone?: PanelTone;
}

export interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
}

export interface TabItem {
  value: string;
  label: string;
  content: ReactNode;
  icon?: ReactNode;
}

export interface TabsProps {
  items: readonly TabItem[];
  label: string;
  defaultValue?: string;
}

export interface AccordionItem {
  question: string;
  answer: ReactNode;
}

export interface AccordionProps {
  items: readonly AccordionItem[];
}

export interface DialogProps {
  triggerLabel: string;
  title: string;
  children: ReactNode;
  closeLabel?: string;
}

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  closeLabel?: string;
  children: ReactNode;
}

export interface TooltipProps {
  content: string;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}

export interface ToastProps {
  tone?: Tone;
  title: string;
  description?: string;
}

export interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export interface CodeBlockProps {
  code: string;
  language: string;
  copyLabel?: string;
}

export interface NavLink {
  href: string;
  label: string;
}

export interface NavPillProps {
  brand: ReactNode;
  links: readonly NavLink[];
  action?: ReactNode;
}
