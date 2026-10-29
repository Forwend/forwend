import { chainName } from "@/shared/lib/chains";
import { foldText } from "@/shared/lib/search";
import type { AssetGroup, AssetOption } from "@/shared/types/asset-selection";

const key = (option: AssetOption) => `${option.chainId}:${option.token}`;

/** Every word must match the symbol, the network or the contract, so "usdc base" and "0x036c" both find one. */
function matches(option: AssetOption, words: readonly string[]): boolean {
  const text = foldText(`${option.symbol} ${chainName(option.chainId)} ${option.token}`);
  return words.every((word) => text.includes(word));
}

/** The options grouped by the allowlist's symbol, each group's networks by name; null `only` keeps every option. */
export function assetGroups(
  options: readonly AssetOption[],
  query: string,
  only: ReadonlySet<string> | null,
): AssetGroup[] {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  const groups = new Map<string, AssetOption[]>();
  for (const option of options) {
    if (only && !only.has(key(option))) continue;
    if (!matches(option, words)) continue;
    const group = groups.get(option.symbol);
    if (group) group.push(option);
    else groups.set(option.symbol, [option]);
  }
  return [...groups]
    .map(([symbol, list]) => ({
      symbol,
      options: list.sort((a, b) => chainName(a.chainId).localeCompare(chainName(b.chainId))),
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** One line a person can check at a glance: each asset with its network count, or totals once there are many. */
export function selectionSummary(
  options: readonly AssetOption[],
  selected: ReadonlySet<string>,
): string {
  const chosen = options.filter((option) => selected.has(key(option)));
  if (chosen.length === 0) return "Nothing accepted yet.";
  const byAsset = new Map<string, number>();
  for (const option of chosen) byAsset.set(option.symbol, (byAsset.get(option.symbol) ?? 0) + 1);
  const networks = new Set(chosen.map((option) => option.chainId)).size;
  const count = (n: number) => (n === 1 ? "1 network" : `${n} networks`);
  if (byAsset.size > 3) return `Accepting ${byAsset.size} assets on ${count(networks)}.`;
  const parts = [...byAsset].map(([symbol, n]) => `${symbol} on ${count(n)}`);
  const list =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `Accepting ${list}.`;
}
