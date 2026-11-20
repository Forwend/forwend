import { crossQuoteSchema, crossTokensSchema } from "@/features/pay/schemas/crosschain";
import type { CrossQuote, CrossTokens } from "@/features/pay/types/crosschain";
import { apiSlice } from "@/shared/api/api-slice";
import type { ApiBody } from "@/shared/types/api-contract";

const crossChain = (payToken: string) => `/v1/invoices/${encodeURIComponent(payToken)}/crosschain`;

export const crossChainApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    getCrossTokens: build.query<CrossTokens, string>({
      query: (payToken) => `${crossChain(payToken)}/tokens`,
      responseSchema: crossTokensSchema,
    }),
    getCrossPrice: build.query<CrossQuote, { payToken: string; originAsset: string }>({
      query: ({ payToken, originAsset }) => ({
        url: `${crossChain(payToken)}/price`,
        params: { originAsset },
      }),
      responseSchema: crossQuoteSchema,
    }),
    createCrossQuote: build.mutation<
      CrossQuote,
      { payToken: string; originAsset: string; refundTo: string; preview: boolean }
    >({
      query: ({ payToken, originAsset, refundTo, preview }) => ({
        url: `${crossChain(payToken)}/quotes`,
        method: "POST",
        body: { originAsset, refundTo, preview } satisfies ApiBody<
          "/v1/invoices/{payToken}/crosschain/quotes",
          "post"
        >,
      }),
      responseSchema: crossQuoteSchema,
    }),
  }),
});

export const { useGetCrossTokensQuery, useGetCrossPriceQuery, useCreateCrossQuoteMutation } =
  crossChainApi;
