"use client";

import { createContext, useContext } from "react";
import type { Profile } from "@/types/app/profile";

/** The profile chosen in the switcher; the app shell provides it once the profiles are loaded. */
export const ActiveProfileContext = createContext<Profile | null>(null);

export function useActiveProfile(): Profile {
  const profile = useContext(ActiveProfileContext);
  if (!profile) throw new Error("useActiveProfile needs the app shell");
  return profile;
}
