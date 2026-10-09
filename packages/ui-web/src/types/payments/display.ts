import type { ReactNode } from "react";
import type { ACTIVITY_DIRECTIONS } from "../../constants/activity";
import type { PAYMENT_STATUSES } from "../../constants/payment-status";
import type { STEP_STATES } from "../../constants/timeline";

export type PaymentStatus = keyof typeof PAYMENT_STATUSES;
export type StepState = (typeof STEP_STATES)[keyof typeof STEP_STATES];
export type ActivityDirection = (typeof ACTIVITY_DIRECTIONS)[keyof typeof ACTIVITY_DIRECTIONS];

export interface MoneyProps {
  baseUnits: bigint;
  decimals: number;
  token?: string;
  fractionDigits?: number;
  className?: string;
}

export interface TokenChipProps {
  token: string;
  network: string;
}

export interface AddressProps {
  address: string;
  explorerHref?: string;
  copyLabel?: string;
  copiedLabel?: string;
  failedLabel?: string;
}

export interface ReceiveAddressProps {
  address: string;
  label?: string;
  copyLabel?: string;
  copiedLabel?: string;
  failedLabel?: string;
}

export interface QrCodeProps {
  value: string;
  /** Accessible description of what the code holds. */
  label: string;
  className?: string;
}

export interface StatusPillProps {
  status: PaymentStatus;
}

export interface TimelineStep {
  label: string;
  state: StepState;
  detail?: string;
}

export interface PaymentTimelineProps {
  steps: readonly TimelineStep[];
  label: string;
}

export interface StatTileProps {
  label: string;
  value: ReactNode;
  note?: string;
}

export interface ActivityRowProps {
  title: string;
  detail: string;
  direction: ActivityDirection;
  amount: MoneyProps;
  status: PaymentStatus;
}

export interface NetworkWarningProps {
  network: string;
  token: string;
}
