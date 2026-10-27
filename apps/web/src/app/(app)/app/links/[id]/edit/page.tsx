import { LinkFormScreen } from "@/screens/links/link-form-screen";
export default async function EditLinkPage({ params }: PageProps<"/app/links/[id]/edit">) {
  const { id } = await params;
  return <LinkFormScreen linkId={id} />;
}
