import type { MfaMethod } from "@privy-io/react-auth";

/** The second steps Forwend sets up and asks for (R-219). */
export type TwoStepMethod = Extract<MfaMethod, "passkey" | "totp">;
