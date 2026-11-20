import { Button, EmptyState } from "@forwend/ui-web";
import { WifiOff } from "lucide-react";
import { PAY_COPY as COPY } from "@/features/pay/constants/pay-copy";

/** data-load-error: the screen centers this state alone. */
export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      data-load-error
      className="mx-auto w-full max-w-lg lg:col-span-2 lg:self-center lg:justify-self-center"
    >
      <EmptyState
        icon={WifiOff}
        title={COPY.failedTitle}
        description={COPY.failed}
        action={
          <Button variant="secondary" onClick={onRetry}>
            {COPY.retry}
          </Button>
        }
      />
    </div>
  );
}
