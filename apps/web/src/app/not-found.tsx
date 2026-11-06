import { BUTTON_SIZES, buttonClasses } from "@forwend/ui-web";
import type { Metadata } from "next";
import Link from "next/link";
import { SIGN_IN_COPY } from "@/features/auth/constants/sign-in";
import { LandscapePage } from "@/shared/components/landscape-page/landscape-page";

const NOT_FOUND = {
  code: "404",
  title: "This path ends here.",
  body: "This page doesn't exist or has moved.",
  action: "Back to Forwend",
} as const;

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

// As the sign-in page: the same bar, landscape and centered column, so a wrong link still looks like Forwend.
export default function NotFound() {
  return (
    <LandscapePage homeLabel={SIGN_IN_COPY.homeLabel}>
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-sm font-medium text-muted tabular-nums">{NOT_FOUND.code}</p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance text-ink">
          {NOT_FOUND.title}
        </h1>
        <p className="text-muted">{NOT_FOUND.body}</p>
        <Link href="/" className={`mt-6 w-full ${buttonClasses({ size: BUTTON_SIZES.lg })}`}>
          {NOT_FOUND.action}
        </Link>
      </div>
    </LandscapePage>
  );
}
