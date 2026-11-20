import { useEffect, useState } from "react";
import { useSearchClientsQuery } from "@/features/clients/api/clients-api";
import { SEARCH_DELAY_MS } from "@/shared/constants/search";
import { apiSearch } from "@/shared/lib/search";

/** What is typed reaches the API SEARCH_DELAY_MS after the last key. */
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
    any: (first.currentData?.length ?? 0) > 0, // the profile has a saved client
    clients: shown.currentData ?? shown.data ?? [], // the last ones kept while the next loads
    pending: wanted !== q || shown.isFetching,
    failed: Boolean(q) && found.isError && !found.isFetching,
    search: setTyped,
  };
}

export type ClientSearch = ReturnType<typeof useClientSearch>;
