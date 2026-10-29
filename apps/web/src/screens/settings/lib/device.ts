// First match wins: Edge and Opera also say Chrome, and Chrome also says Safari.
const BROWSERS = [
  ["Edg/", "Edge"],
  ["OPR/", "Opera"],
  ["Firefox/", "Firefox"],
  ["Chrome/", "Chrome"],
  ["Safari/", "Safari"],
] as const;
const SYSTEMS = [
  ["iPhone", "iOS"],
  ["iPad", "iPadOS"],
  ["Android", "Android"],
  ["Mac OS X", "macOS"],
  ["Windows", "Windows"],
  ["Linux", "Linux"],
] as const;

/** "Chrome on macOS" from the browser's own description; null when it names neither. */
export function deviceName(userAgent: string): string | null {
  const browser = BROWSERS.find(([mark]) => userAgent.includes(mark))?.[1];
  const system = SYSTEMS.find(([mark]) => userAgent.includes(mark))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? null;
}
