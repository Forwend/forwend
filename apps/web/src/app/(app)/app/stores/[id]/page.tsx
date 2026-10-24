import { StoreScreen } from "@/screens/stores/store-screen";

export default async function StorePage({ params }: PageProps<"/app/stores/[id]">) {
  const { id } = await params;
  return <StoreScreen storeId={id} />;
}
