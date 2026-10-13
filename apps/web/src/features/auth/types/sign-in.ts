import type { SIGN_IN_STEPS } from "@/features/auth/constants/sign-in";

export type SignInStep = (typeof SIGN_IN_STEPS)[keyof typeof SIGN_IN_STEPS];
