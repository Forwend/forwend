import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/** The search's URL parameter, also the API's. */
export const SEARCH_PARAM = "q";
/** The API's longest search in characters. */
export const SEARCH_MAX = 100;
/** How long the search waits after the last key before it asks the API. */
export const SEARCH_DELAY_MS = 300;

/** The query string with name set to value, or removed when value is empty: "?a=1&q=x", or "" when none is left. */
export function withParam(query: string, name: string, value: string): string {
  const params = new URLSearchParams(query);
  if (value) params.set(name, value);
  else params.delete(name);
  const next = params.toString();
  return next ? `?${next}` : "";
}

/** The search as the API takes it: trimmed and cut to its limit, undefined when blank (no search). */
export function apiSearch(search: string): string | undefined {
  return search.trim().slice(0, SEARCH_MAX) || undefined;
}

// Replaces the current history entry: Next keeps useSearchParams in step, and Back leaves the list as it was.
function setParam(name: string, value: string) {
  const { pathname, search, hash } = window.location;
  window.history.replaceState(null, "", `${pathname}${withParam(search, name, value)}${hash}`);
}

/**
 * A list's filter and search, kept in the URL (?<filterParam>= and ?q=) so reload and Back keep them. `filter` is
 * all unless the URL names one of filters; `search` is the field's text, which reaches ?q SEARCH_DELAY_MS after the
 * last change. `apiFilter` and `apiQuery` are what the API takes (undefined: all, no search); `filtered` is whether
 * either narrows the list, and `key` names the pair.
 */
export function useListFilters<F extends string, All extends F>(
  filterParam: string,
  filters: readonly F[],
  all: All,
) {
  const params = useSearchParams();
  const filter = filters.find((f) => f === params.get(filterParam)) ?? all;
  const query = params.get(SEARCH_PARAM) ?? "";
  const [search, setSearch] = useState(query);
  const [written, setWritten] = useState(query);
  const [seen, setSeen] = useState(query);
  // ?q changed by Back or a link: the field shows it. Our own writes leave the field alone, so keys typed while the
  // URL catches up stay.
  if (query !== seen) {
    setSeen(query);
    if (query !== written) setSearch(query);
    setWritten(query);
  }

  useEffect(() => {
    const next = search.trim();
    if (next === query) return;
    const timer = setTimeout(() => {
      setWritten(next);
      setParam(SEARCH_PARAM, next);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search, query]);

  const apiFilter = filter === all ? undefined : (filter as Exclude<F, All>);
  const apiQuery = apiSearch(query);
  return {
    filter,
    apiFilter,
    apiQuery,
    key: `${apiFilter ?? ""} ${apiQuery ?? ""}`,
    filtered: apiFilter !== undefined || apiQuery !== undefined,
    setFilter: (value: F) => setParam(filterParam, value === all ? "" : value),
    search,
    setSearch,
    clear: () => {
      setSearch("");
      setWritten("");
      setParam(SEARCH_PARAM, "");
      setParam(filterParam, "");
    },
  };
}

/**
 * The answer a list shows when "Show more" asks again with a larger limit: the current one, else, while that loads,
 * the last one under the same filter and search (key). Never the answer to another filter or search.
 */
export function useShownData<T>(
  key: string,
  current: T | undefined,
  last: T | undefined,
): T | undefined {
  const [shownKey, setShownKey] = useState(key);
  if (current !== undefined && shownKey !== key) setShownKey(key);
  return current ?? (shownKey === key ? last : undefined);
}
