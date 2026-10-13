import { Badge } from "@forwend/ui-web";
import type { ReactNode } from "react";
import { PROFILES } from "@/screens/landing/sections/profile-preview/constants/profile-preview-content";
import type { ProfileTab } from "@/screens/landing/sections/profile-preview/types/profile-preview-content";

interface ProfilePanelLayoutProps {
  tab: ProfileTab;
  children: ReactNode;
}

export function PanelLayout({ tab, children }: ProfilePanelLayoutProps) {
  const copy = PROFILES.tabs[tab];
  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
      <div>
        <h3 className="text-2xl font-semibold text-ink">{copy.title}</h3>
        <p className="mt-3 max-w-md text-lg text-muted">{copy.body}</p>
      </div>
      <div className="rounded-xl border border-line bg-surface-2 p-3 sm:p-4">
        <div className="mb-3 flex justify-end">
          <Badge>Sample</Badge>
        </div>
        {children}
      </div>
    </div>
  );
}
