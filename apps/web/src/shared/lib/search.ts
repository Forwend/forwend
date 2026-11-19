/** Lower case without accents, as the kit's search selects compare, so "zur" finds Zürich. */
export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Every word of the query is somewhere in the text, both folded: "usdc base" finds "USDC Base Sepolia". */
export function matchesWords(text: string, query: string): boolean {
  const folded = foldText(text);
  return foldText(query)
    .split(/\s+/)
    .every((word) => folded.includes(word));
}
