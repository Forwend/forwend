"use client";

import { createContext, useContext } from "react";
import type { Profile } from "@/features/profiles/profile";

/** What the app shell gives its pages once the user's profiles are loaded. */
export interface AppSession {
  /** The profile chosen in the switcher. */
  profile: Profile;
  profiles: Profile[];
  /** A fresh Privy access token for API calls. */
  token: () => Promise<string>;
  /** Adds a new profile and makes it the chosen one. */
  addProfile: (profile: Profile) => void;
}

export const AppSessionContext = createContext<AppSession | null>(null);

export function useAppSession(): AppSession {
  const session = useContext(AppSessionContext);
  if (!session) throw new Error("useAppSession needs the app shell");
  return session;
}
