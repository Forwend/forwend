import { KIT_ENV } from "@/constants/kit";

// Read at request time, so one build can serve with or without the kit.
export function isKitEnabled(): boolean {
  return process.env[KIT_ENV.flag] === KIT_ENV.on;
}
