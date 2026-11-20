import { BUTTON_SIZES, buttonClasses } from "@forwend/ui-web";
import type { Metadata } from "next";
import Link from "next/link";
import { LandscapePage } from "@/shared/components/landscape-page/landscape-page";
import { NO_INDEX } from "@/shared/config/site";

const NOT_FOUND = {
  code: "404",
  title: "This path ends here.",
  body: "This page doesn't exist or has moved.",
  action: "Back to Forwend",
} as const;

export const metadata: Metadata = {
  title: "Page not found",
  robots: NO_INDEX,
};

export default function NotFound() {
  return (
    <LandscapePage>
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="font-display text-8xl leading-none font-medium tracking-tighter text-ink tabular-nums">
          {NOT_FOUND.code}
        </p>
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
