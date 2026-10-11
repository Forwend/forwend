/** "0x1234567890…5678" → "0x1234…5678": first 6 and last 4 characters. */
export function shortAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}
