"use client";

import { type DependencyList, useCallback, useEffect, useRef, useState } from "react";

/**
 * Loads data for the current deps, keeping what is shown until the new answer arrives; a new resetKey (another
 * profile) clears it. With refreshMs it loads again on that interval while the tab is visible, and when the tab comes
 * back. Only the newest request's answer is used, so a slow older answer never replaces a newer one.
 */
export function useLoad<T>(
  load: () => Promise<T>,
  deps: DependencyList,
  options: { refreshMs?: number; resetKey?: string } = {},
) {
  const { refreshMs, resetKey } = options;
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [run, setRun] = useState(0);
  const latest = useRef(0);
  const shownKey = useRef(resetKey);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the caller's deps (and Retry) decide when to load again
  const stable = useCallback(load, [...deps, run]);

  useEffect(() => {
    if (shownKey.current !== resetKey) {
      shownKey.current = resetKey;
      setData(null);
      setUpdatedAt(null);
    }
    let mounted = true;
    const fetchOnce = () => {
      const request = ++latest.current;
      setLoading(true);
      stable()
        .then((value) => {
          if (!mounted || request !== latest.current) return;
          setData(value);
          setFailed(false);
          setUpdatedAt(new Date());
        })
        .catch(() => mounted && request === latest.current && setFailed(true))
        .finally(() => mounted && request === latest.current && setLoading(false));
    };
    fetchOnce();
    if (!refreshMs) {
      return () => {
        mounted = false;
      };
    }
    const visible = () => document.visibilityState === "visible";
    const timer = setInterval(() => visible() && fetchOnce(), refreshMs);
    const onVisible = () => visible() && fetchOnce();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [stable, refreshMs, resetKey]);

  return { data, failed, loading, updatedAt, reload: () => setRun((n) => n + 1) };
}
