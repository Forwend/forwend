import { StoreFormScreen } from "@/screens/stores/store-form-screen";

export default async function EditStorePage({ params }: PageProps<"/app/stores/[id]/edit">) {
  const { id } = await params;
  return <StoreFormScreen storeId={id} />;
}
