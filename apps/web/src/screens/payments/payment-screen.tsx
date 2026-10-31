"use client";

import { PAYMENT_STATUS } from "@forwend/ui-web";
import { CheckoutActions } from "@/features/checkout/components/checkout-actions";
import { PaymentDetail } from "@/features/payments/components/payment-detail";
import { PAYMENT_SOURCE } from "@/features/payments/constants/payments";
import { paymentDisplayStatus } from "@/features/payments/lib/payments";
import { PERMISSIONS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { can } from "@/features/profiles/lib/profile";

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
      actions={(payment, focusTitle) =>
        payment.source === PAYMENT_SOURCE.checkout && can(profile, PERMISSIONS.invoicesWrite) ? (
          <CheckoutActions
            profileId={profile.profileId}
            paymentId={payment.paymentId}
            cancelable={paymentDisplayStatus(payment) === PAYMENT_STATUS.open}
            onDone={focusTitle}
          />
        ) : null
      }
    />
  );
}
