import type { AMOUNT_ERRORS } from "@/shared/constants/money";

export type AmountError = (typeof AMOUNT_ERRORS)[keyof typeof AMOUNT_ERRORS];
