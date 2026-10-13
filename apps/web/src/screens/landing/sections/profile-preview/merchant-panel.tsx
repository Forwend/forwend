import { ActivityRow } from "@forwend/ui-web";
import { PROFILE_TABS } from "@/screens/landing/sections/profile-preview/constants/profile-preview-content";
import { SAMPLE_STORE_ACTIVITY } from "@/screens/landing/sections/profile-preview/constants/profile-preview-samples";
import { PanelLayout } from "@/screens/landing/sections/profile-preview/panel-layout";

export function MerchantPanel() {
  return (
    <PanelLayout tab={PROFILE_TABS.merchant}>
      <div className="divide-y divide-line rounded-lg border border-line bg-surface px-4">
        {SAMPLE_STORE_ACTIVITY.map((row) => (
          <ActivityRow key={row.title} {...row} />
        ))}
      </div>
    </PanelLayout>
  );
}
