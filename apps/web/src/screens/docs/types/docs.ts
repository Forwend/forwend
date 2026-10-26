/** One section of the docs page (R-155). */
export interface DocsSection {
  id: string;
  title: string;
  /** Text in `backticks` shows as code. */
  paragraphs?: readonly string[];
  points?: readonly string[];
  code?: { language: string; code: string };
}
