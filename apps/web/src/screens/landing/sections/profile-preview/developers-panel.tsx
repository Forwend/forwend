import { PROFILE_TABS } from "@/screens/landing/sections/profile-preview/constants/profile-preview-content";
import { SAMPLE_EVENTS } from "@/screens/landing/sections/profile-preview/constants/profile-preview-samples";
import { PanelLayout } from "@/screens/landing/sections/profile-preview/panel-layout";

export function DevelopersPanel() {
  return (
    <PanelLayout tab={PROFILE_TABS.developers}>
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface px-4 font-mono text-sm">
        {SAMPLE_EVENTS.map((e) => (
          <li key={e.type} className="flex min-h-16 items-center justify-between gap-4">
            <span className="text-ink">{e.type}</span>
            <span className="text-subtle tabular-nums">{e.time}</span>
          </li>
        ))}
      </ul>
    </PanelLayout>
  );
}
