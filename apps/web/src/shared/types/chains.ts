import type { CROSS_CHAIN_STATUSES } from "@/shared/constants/chains";

export type CrossChainStatus = (typeof CROSS_CHAIN_STATUSES)[keyof typeof CROSS_CHAIN_STATUSES];
