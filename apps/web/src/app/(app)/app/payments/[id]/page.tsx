import { PaymentScreen } from "@/screens/payments/payment-screen";
export default async function PaymentPage({ params }: PageProps<"/app/payments/[id]">) {
  const { id } = await params;
  return <PaymentScreen paymentId={id} />;
}
