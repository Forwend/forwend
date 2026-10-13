import type { ReceiveOption } from "@/features/receive/types/receive-choice";

/** The token is picked first, then the network; when only one is on offer it is picked for the user. */
export function receiveChoice<T extends ReceiveOption>(
  options: readonly T[],
  symbol: string | null,
  network: string | null,
) {
  const symbols = [...new Set(options.map((o) => o.symbol))];
  const token = symbol ?? (symbols.length === 1 ? symbols[0] : null);
  const networks = options.filter((o) => o.symbol === token);
  const option =
    networks.find((o) => o.network === network) ?? (networks.length === 1 ? networks[0] : null);
  return { symbols, symbol: token ?? null, networks, option };
}

/** Each chain family has its own receive address; one EVM wallet address serves every EVM network. */
export function addressFor(
  option: ReceiveOption,
  addresses: Readonly<Record<string, string>>,
): string | null {
  return addresses[option.family] ?? null;
}
