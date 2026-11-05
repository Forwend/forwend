import { useEffect, useState } from "react";
import { useSearchClientsQuery } from "@/features/clients/api/clients-api";
import { apiSearch, SEARCH_DELAY_MS } from "@/shared/hooks/use-list-filters";

/** A client picker's search through the API (R-177): what is typed reaches it SEARCH_DELAY_MS after the last key. */
export function useClientSearch(profileId: string, skip = false) {
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState<string | undefined>(undefined);
  const wanted = apiSearch(typed);
  useEffect(() => {
    // An emptied search shows the first clients at once; only a typed one waits for the last key.
    if (!wanted) return setQ(undefined);
    const timer = setTimeout(() => setQ(wanted), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [wanted]);
  const first = useSearchClientsQuery({ profileId }, { skip });
  const found = useSearchClientsQuery({ profileId, q }, { skip: skip || !q });
  const shown = q ? found : first;
  return {
    /** Whether the profile has a saved client at all: the picker shows only then. */
    any: (first.currentData?.length ?? 0) > 0,
    /** The matches for what was typed, the last ones kept while the next answer is on its way. */
    clients: shown.currentData ?? shown.data ?? [],
    /** The list isn't yet the answer for what is typed. */
    pending: wanted !== q || shown.isFetching,
    /** The last search failed: the list holds no answer for it. */
    failed: Boolean(q) && found.isError && !found.isFetching,
    search: setTyped,
  };
}

export type ClientSearch = ReturnType<typeof useClientSearch>;
