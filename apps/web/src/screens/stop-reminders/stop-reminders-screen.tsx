import { Logo } from "@forwend/ui-web";
import Link from "next/link";
import { StopReminders } from "@/features/invoices/components/stop-reminders";
import { APP_ROUTES } from "@/shared/config/routes";

/** The page a payment reminder's Stop reminders link opens (R-96). */
export function StopRemindersScreen({ token }: { token: string }) {
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-6xl flex-col gap-8 fw-safe-x pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))] lg:gap-12 lg:py-10">
      <header className="flex items-center gap-3">
        <Link
          href={APP_ROUTES.site}
          className="self-start rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-focus"
        >
          <Logo />
        </Link>
      </header>
      {/* Phones: the panel sits under the logo, like the pay panel; it centers from small screens up. */}
      <main className="flex flex-1 flex-col sm:items-center sm:justify-center sm:pb-24">
        <StopReminders token={token} />
      </main>
    </div>
  );
}
