import { useSearchParams } from "next/navigation";
import { useListSearch } from "@/shared/hooks/use-list-search";
import { setParam } from "@/shared/lib/url-params";

/** A list's filter and search, kept in the URL; apiFilter and apiQuery are undefined for all and none. */
export function useListFilters<F extends string, All extends F>(
  filterParam: string,
  filters: readonly F[],
  all: All,
) {
  const params = useSearchParams();
  const filter = filters.find((f) => f === params.get(filterParam)) ?? all;
  const { apiQuery, search, setSearch, clear } = useListSearch();
  const apiFilter = filter === all ? undefined : (filter as Exclude<F, All>);
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
      clear();
      setParam(filterParam, "");
    },
  };
}
