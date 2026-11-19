import type { Profile } from "@/features/profiles/types/profile";

export interface AppSession {
  profile: Profile;
  profiles: Profile[];
  chooseProfile: (profileId: string) => void;
  openReceive: () => void;
  openSend: (() => void) | null; // null when the role can't move money
  openTransfer: (() => void) | null;
  openRequest: () => void;
  signOut: () => Promise<void>;
}
