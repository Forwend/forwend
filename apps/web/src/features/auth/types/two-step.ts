import type { MfaMethod } from "@privy-io/react-auth";

export type TwoStepMethod = Extract<MfaMethod, "passkey" | "totp">;
