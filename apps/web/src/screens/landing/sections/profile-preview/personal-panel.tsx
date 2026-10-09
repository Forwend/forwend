import { ActivityRow, Money, StatTile } from "@forwend/ui-web";
import { PanelLayout } from "@/screens/landing/sections/profile-preview/panel-layout";
import { PROFILE_TABS } from "@/screens/landing/sections/profile-preview/profile-preview-content";
import {
  SAMPLE_BALANCES,
  SAMPLE_PERSONAL_ACTIVITY,
} from "@/screens/landing/sections/profile-preview/profile-preview-samples";

export function PersonalPanel() {
  return (
    <PanelLayout tab={PROFILE_TABS.personal}>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Available"
          value={<Money {...SAMPLE_BALANCES.available} />}
          note="On Base"
        />
        <StatTile
          label="Arriving"
          value={<Money {...SAMPLE_BALANCES.incoming} />}
          note="Confirming"
        />
        <StatTile
          label="Held for a refund"
          value={<Money {...SAMPLE_BALANCES.held} />}
          note="Not yours to spend"
        />
      </div>
      <div className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface px-4">
        {SAMPLE_PERSONAL_ACTIVITY.map((row) => (
          <ActivityRow key={row.title} {...row} />
        ))}
      </div>
    </PanelLayout>
  );
}
