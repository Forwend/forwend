import { useGetBalancesQuery } from "@/features/balances/api/balances-api";
import { useGetPricesQuery } from "@/features/prices/api/prices-api";
import { PRICES_QUERY } from "@/features/prices/constants/prices";
import { LIVE_QUERY } from "@/shared/config/refresh";

/** A profile's balances with the market prices that value them. Until the prices answer or fail, the balances count
 * as still loading, so a total never shows "no prices" for prices that are on their way. */
export function usePricedBalances(profileId: string) {
  const balances = useGetBalancesQuery(profileId, LIVE_QUERY);
  const priced = useGetPricesQuery(undefined, PRICES_QUERY);
  return {
    balances: priced.isLoading ? null : (balances.currentData ?? null),
    prices: priced.currentData?.prices,
    failed: balances.isError,
    retry: () => void balances.refetch(),
  };
}
