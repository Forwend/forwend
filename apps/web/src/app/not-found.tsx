import { BUTTON_SIZES, buttonClasses } from "@forwend/ui-web";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { NOT_FOUND } from "@/constants/copy";
import { NOT_FOUND_IMAGE } from "@/constants/landing-images";
import { SITE } from "@/constants/site";

export const metadata: Metadata = {
  title: `Page not found · ${SITE.name}`,
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="relative isolate flex min-h-svh flex-col items-center px-4 pt-6 pb-16 text-center sm:px-8">
      <Image
        src={NOT_FOUND_IMAGE.src}
        alt=""
        fill
        priority
        sizes="100vw"
        className="-z-20 object-cover object-[68%_70%] lg:object-[50%_70%] dark:brightness-50"
      />
      {/* Light behind the text in both themes, and a fade into the page at the bottom. */}
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_80%_55%_at_50%_35%,color-mix(in_oklab,var(--fw-bg)_82%,transparent),transparent)]" />
      <Link href="/" className="font-semibold tracking-tight text-ink">
        {SITE.name}
      </Link>
      <div className="mt-32 sm:mt-40 flex max-w-2xl flex-col items-center">
        <p className="font-mono text-sm text-muted">404</p>
        <h1 className="mt-3 font-display text-section text-ink">{NOT_FOUND.title}</h1>
        <p className="mt-4 text-lg text-muted">{NOT_FOUND.body}</p>
        <Link href="/" className={`mt-8 ${buttonClasses({ size: BUTTON_SIZES.lg })}`}>
          {NOT_FOUND.action}
        </Link>
      </div>
    </main>
  );
}
