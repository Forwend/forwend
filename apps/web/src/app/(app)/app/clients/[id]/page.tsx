import { ClientScreen } from "@/screens/clients/client-screen";

export default async function ClientPage({ params }: PageProps<"/app/clients/[id]">) {
  const { id } = await params;
  return <ClientScreen clientId={id} />;
}
