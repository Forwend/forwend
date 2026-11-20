import { useSyncExternalStore } from "react";
import { DESKTOP_QUERY } from "@/shared/config/breakpoints";

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

/** True from the desktop width; true on the server, so a phone's first render after hydration may differ. */
export function useDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  );
}
