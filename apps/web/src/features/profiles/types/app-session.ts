import type { Profile } from "@/features/profiles/types/profile";

export interface AppSession {
  profile: Profile;
  profiles: Profile[];
  chooseProfile: (profileId: string) => void;
  openReceive: () => void;
  openRequest: () => void;
}
