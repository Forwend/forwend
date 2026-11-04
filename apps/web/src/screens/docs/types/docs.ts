export interface DocsField {
  name: string;
  type: string;
  description: string;
}

export interface DocsSection {
  id: string;
  title: string;
  paragraphs?: readonly string[];
  points?: readonly string[];
  code?: { language: string; code: string };
  fields?: readonly DocsField[];
  fieldLabel?: string;
  method?: "GET" | "POST";
  path?: string;
  scope?: string;
  links?: readonly { label: string; slug: string }[];
}

export interface DocsArticle {
  slug: string;
  group: string;
  title: string;
  description: string;
  sections: readonly DocsSection[];
  next?: string;
  previous?: string;
}

export interface DocsSearchEntry {
  title: string;
  section: string;
  text: string;
  href: string;
}
