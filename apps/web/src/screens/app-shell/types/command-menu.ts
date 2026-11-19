import type { LucideIcon } from "lucide-react";

export interface Command {
  id: string;
  group: string;
  label: string;
  detail?: string;
  keywords?: string; // searched but not shown
  icon: LucideIcon;
  run: () => void;
}
