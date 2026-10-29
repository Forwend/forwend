import { ClientFormScreen } from "@/screens/clients/client-form-screen";

export default async function EditClientPage({ params }: PageProps<"/app/clients/[id]/edit">) {
  const { id } = await params;
  return <ClientFormScreen clientId={id} />;
}
