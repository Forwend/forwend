import { InvoiceScreen } from "@/screens/invoices/invoice-screen";

export default async function InvoicePage({ params }: PageProps<"/app/invoices/[id]">) {
  const { id } = await params;
  return <InvoiceScreen invoiceId={id} />;
}
