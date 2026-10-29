import { NewProfileForm } from "@/features/profiles/components/new-profile-form";
import { NEW_PROFILE_COPY } from "@/features/profiles/constants/profiles-copy";

export function NewProfileScreen() {
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        {/* The header's breadcrumb names the page on desktop, so the heading shows only on phones. */}
        <h1 className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">
          {NEW_PROFILE_COPY.title}
        </h1>
        <p className="text-sm text-muted">{NEW_PROFILE_COPY.intro}</p>
      </div>
      <NewProfileForm />
    </div>
  );
}
