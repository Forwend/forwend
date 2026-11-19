import { useEffect, useState } from "react";

const COLLAPSED_KEY = "forwend:sidebar-collapsed";

/** Whether the desktop sidebar shows only its icons, as this browser last left it. */
export function useCollapsedSidebar(): [collapsed: boolean, toggle: () => void] {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      // Storage blocked: the sidebar starts open.
    }
  }, []);
  const toggle = () => {
    setCollapsed((was) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, was ? "0" : "1");
      } catch {
        // Storage blocked: the choice lasts for this page view.
      }
      return !was;
    });
  };
  return [collapsed, toggle];
}
