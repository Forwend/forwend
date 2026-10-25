import { LinkScreen } from "@/screens/links/link-screen";

export default async function LinkPage({ params }: PageProps<"/app/links/[id]">) {
  const { id } = await params;
  return <LinkScreen linkId={id} />;
}
