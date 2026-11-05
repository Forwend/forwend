import {
  useGetBalanceHistoryQuery,
  useGetBalancesQuery,
} from "@/features/balances/api/balances-api";
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

/** The balance history with the prices that value it (historySeries). Until the prices answer or fail, the history
 * counts as still loading, as the balances do. */
export function usePricedHistory(profileId: string, days: number) {
  const history = useGetBalanceHistoryQuery({ profileId, days }, LIVE_QUERY);
  const priced = useGetPricesQuery(undefined, PRICES_QUERY);
  const waiting = priced.isLoading;
  return {
    ...history,
    data: waiting ? undefined : history.data,
    currentData: waiting ? undefined : history.currentData,
    prices: priced.currentData?.prices,
  };
}
