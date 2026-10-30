import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

export const NOTICE_TONES = { warning: "warning", danger: "danger" } as const;
export type NoticeTone = (typeof NOTICE_TONES)[keyof typeof NOTICE_TONES];
export const NOTICE_ALIGNS = { start: "start", center: "center" } as const;
export type NoticeAlign = (typeof NOTICE_ALIGNS)[keyof typeof NOTICE_ALIGNS];

export interface NoticeProps {
  children: ReactNode;
  tone?: NoticeTone;
  /** One short way out at the strip's end, such as Try again. */
  action?: ReactNode;
  /** center: a line that needs no way out, such as a connection that is being retried. */
  align?: NoticeAlign;
  /** alert for something that just went wrong while the view was open, such as a failed refresh. */
  role?: "status" | "alert";
  className?: string;
}

const TONE_CLASSES: Record<NoticeTone, string> = {
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

/** One short line about the whole view, across its full width: a refresh that failed, or a problem it shows nowhere else. */
export function Notice({
  children,
  tone = NOTICE_TONES.warning,
  action,
  align = NOTICE_ALIGNS.start,
  role,
  className = "",
}: NoticeProps) {
  const center = align === NOTICE_ALIGNS.center;
  return (
    <div
      role={role ?? (tone === NOTICE_TONES.danger ? "alert" : "status")}
      className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-4 py-2 text-sm ${center ? "justify-center text-center" : ""} ${TONE_CLASSES[tone]} ${className}`}
    >
      <TriangleAlert aria-hidden className="size-[var(--fw-icon-sm)] shrink-0" />
      <span className={center ? "min-w-0" : "min-w-0 flex-1"}>{children}</span>
      {action}
    </div>
  );
}
