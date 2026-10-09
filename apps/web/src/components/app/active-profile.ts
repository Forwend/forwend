"use client";

import { createContext, useContext } from "react";
import type { AppSession } from "@/types/app/session";

export const AppSessionContext = createContext<AppSession | null>(null);

export function useAppSession(): AppSession {
  const session = useContext(AppSessionContext);
  if (!session) throw new Error("useAppSession needs the app shell");
  return session;
}
