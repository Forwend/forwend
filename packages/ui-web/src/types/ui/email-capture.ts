import type { CAPTURE_STATUS } from "../../constants/email-capture";

export type CaptureStatus = (typeof CAPTURE_STATUS)[keyof typeof CAPTURE_STATUS];

export interface EmailCaptureProps {
  status: CaptureStatus;
  /** Shown under the field: the error text, or the success confirmation. */
  message?: string;
  onSubmit: (email: string) => void;
  submitLabel: string;
  /** Visually hidden label for the email field. */
  label?: string;
  placeholder?: string;
}
