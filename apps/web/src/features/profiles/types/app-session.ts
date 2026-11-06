import type { Profile } from "@/features/profiles/types/profile";

export interface AppSession {
  profile: Profile;
  profiles: Profile[];
  chooseProfile: (profileId: string) => void;
  openReceive: () => void;
  /** Send and Transfer open one sheet; null where the user can't move this profile's money (D-61). */
  openSend: (() => void) | null;
  openTransfer: (() => void) | null;
  openRequest: () => void;
  signOut: () => Promise<void>;
}
