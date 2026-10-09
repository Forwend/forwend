import { NewProfileForm } from "@/features/profiles/components/new-profile-form";
import { NEW_PROFILE_COPY } from "@/features/profiles/profiles-copy";

export function NewProfileScreen() {
  return (
    <div className="flex max-w-md flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl text-ink sm:text-4xl">{NEW_PROFILE_COPY.title}</h1>
        <p className="text-muted">{NEW_PROFILE_COPY.intro}</p>
      </div>
      <NewProfileForm />
    </div>
  );
}
