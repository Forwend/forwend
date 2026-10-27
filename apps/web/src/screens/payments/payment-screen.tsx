"use client";
import { PaymentDetail } from "@/features/payments/components/payment-detail";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
export interface PaymentScreenProps {
  paymentId: string;
}
export function PaymentScreen({ paymentId }: PaymentScreenProps) {
  const { profile } = useAppSession();
  return (
    <PaymentDetail
      key={`${profile.profileId}:${paymentId}`}
      profileId={profile.profileId}
      paymentId={paymentId}
    />
  );
}
