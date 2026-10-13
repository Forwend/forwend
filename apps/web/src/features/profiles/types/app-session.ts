import type { Profile } from "@/features/profiles/types/profile";

/** What the app shell gives its pages once the user's profiles are loaded. */
export interface AppSession {
  /** The profile chosen in the switcher. */
  profile: Profile;
  profiles: Profile[];
  /** Makes a profile the chosen one, such as a profile just created. */
  chooseProfile: (profileId: string) => void;
  openReceive: () => void;
  /** Request money: a personal profile's request sheet. */
  openRequest: () => void;
}
