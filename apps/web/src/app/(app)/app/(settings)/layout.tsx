import type { ReactNode } from "react";
import { SettingsFrame } from "@/screens/settings/settings-frame";

export default function SettingsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <SettingsFrame>{children}</SettingsFrame>;
}
