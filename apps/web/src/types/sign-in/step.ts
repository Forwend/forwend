import type { SIGN_IN_STEPS } from "@/constants/sign-in";

export type SignInStep = (typeof SIGN_IN_STEPS)[keyof typeof SIGN_IN_STEPS];
