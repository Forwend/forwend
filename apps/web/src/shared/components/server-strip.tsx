import { NOTICE_ALIGNS, Notice } from "@forwend/ui-web";

const SERVER_COPY = "Can't reach the server. Retrying…";

/** The one line that says the server can't be reached: the view retries on its own, so it offers no button. */
export function ServerStrip({ className }: { className?: string }) {
  return (
    <Notice role="alert" align={NOTICE_ALIGNS.center} className={className}>
      {SERVER_COPY}
    </Notice>
  );
}
