export const KIT_ENV = {
  flag: "KIT_ENABLED",
  on: "1",
} as const;

// Read at request time, so one build can serve with or without the kit.
export function isKitEnabled(): boolean {
  return process.env[KIT_ENV.flag] === KIT_ENV.on;
}
