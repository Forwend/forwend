import { crossQuoteSchema, crossTokensSchema } from "@/features/pay/schemas/crosschain";
import type { CrossQuote, CrossTokens } from "@/features/pay/types/crosschain";
import { apiSlice } from "@/shared/api/api-slice";

const crossChain = (payToken: string) => `/v1/invoices/${encodeURIComponent(payToken)}/crosschain`;

// Public, like the checkout (R-231, R-232): what a payer can pay with from another chain, and its quotes.
export const crossChainApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    getCrossTokens: build.query<CrossTokens, string>({
      query: (payToken) => `${crossChain(payToken)}/tokens`,
      responseSchema: crossTokensSchema,
    }),
    /** A dry quote for a picked token: what the payer sends, without an address. */
    getCrossPrice: build.query<CrossQuote, { payToken: string; originAsset: string }>({
      query: ({ payToken, originAsset }) => ({
        url: `${crossChain(payToken)}/price`,
        params: { originAsset },
      }),
      responseSchema: crossQuoteSchema,
    }),
    /** The deposit address for the token and refund address; the same open quote again while its window lasts. */
    createCrossQuote: build.mutation<
      CrossQuote,
      { payToken: string; originAsset: string; refundTo: string; preview: boolean }
    >({
      query: ({ payToken, originAsset, refundTo, preview }) => ({
        url: `${crossChain(payToken)}/quotes`,
        method: "POST",
        body: { originAsset, refundTo, preview },
      }),
      responseSchema: crossQuoteSchema,
    }),
  }),
});

export const { useGetCrossTokensQuery, useGetCrossPriceQuery, useCreateCrossQuoteMutation } =
  crossChainApi;
