import { Notice } from "@forwend/ui-web";
import Link from "next/link";
import { DEVELOPER_MODE_COPY as COPY } from "@/features/profiles/constants/profiles-copy";
import { APP_ROUTES } from "@/shared/config/routes";

/** Shown in Developer mode, so testnet money never passes for real money. */
export function DeveloperModeStrip({ canTurnOff }: { canTurnOff: boolean }) {
  return (
    <Notice
      className="rounded-none"
      action={
        canTurnOff ? (
          <Link
            href={APP_ROUTES.developerMode}
            className="font-medium underline underline-offset-4 hover:no-underline"
          >
            {COPY.stripAction}
          </Link>
        ) : null
      }
    >
      {COPY.strip}
    </Notice>
  );
}
