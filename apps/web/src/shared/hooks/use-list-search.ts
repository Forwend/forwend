import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SEARCH_DELAY_MS, SEARCH_PARAM } from "@/shared/constants/search";
import { apiSearch } from "@/shared/lib/search";
import { setParam } from "@/shared/lib/url-params";

/** A list's search, kept in ?q for reload and Back; ?q updates SEARCH_DELAY_MS after the last change. */
export function useListSearch() {
  const params = useSearchParams();
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

  return {
    apiQuery: apiSearch(query),
    search,
    setSearch,
    clear: () => {
      setSearch("");
      setWritten("");
      setParam(SEARCH_PARAM, "");
    },
  };
}
