import { NewProfileForm } from "@/features/profiles/components/new-profile-form";
import { NEW_PROFILE_COPY } from "@/features/profiles/profiles-copy";

export function NewProfileScreen() {
  return (
    <div className="flex max-w-md flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{NEW_PROFILE_COPY.title}</h1>
        <p className="text-muted">{NEW_PROFILE_COPY.intro}</p>
      </div>
      <NewProfileForm />
    </div>
  );
}
