/** Text as list searches compare it: lower case without accents, as the kit's search selects do, so "zur" finds Zürich. */
export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}
