import { KIT_ENV } from "@/screens/kit/constants/kit-access";

// Always on in `next dev`; a production build serves it only with the flag, read at request time.
export function isKitEnabled(): boolean {
  return process.env.NODE_ENV === "development" || process.env[KIT_ENV.flag] === KIT_ENV.on;
}
