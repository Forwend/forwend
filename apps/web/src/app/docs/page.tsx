import { DOCS } from "@/screens/docs/constants/docs-content";
import { DocsScreen } from "@/screens/docs/docs-screen";
import { docsMetadata } from "@/screens/docs/lib/docs-metadata";
import { docsPath } from "@/shared/config/docs-routes";

export const metadata = docsMetadata({
  title: DOCS.title,
  heading: DOCS.heading,
  description: DOCS.description,
  path: docsPath(),
});

export default function DocsPage() {
  return <DocsScreen />;
}
