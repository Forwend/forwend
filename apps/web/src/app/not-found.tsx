import { BUTTON_SIZES, buttonClasses, Logo } from "@forwend/ui-web";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { HERO_IMAGE } from "@/shared/assets/images";

const NOT_FOUND = {
  title: "This path ends here.",
  body: "The page you are looking for does not exist or has moved.",
  action: "Back to Forwend",
} as const;

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="relative isolate grid min-h-svh grid-rows-[1fr_auto_1fr] justify-items-center gap-8 px-6 py-6 text-center sm:px-8">
      <Image
        src={HERO_IMAGE.src}
        alt=""
        fill
        priority
        sizes="100vw"
        className="-z-20 object-cover object-[50%_80%] saturate-[.65] dark:brightness-[.45] dark:grayscale-[.7]"
      />
      {/* Keep the centered message readable over the landscape in both themes. */}
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_90%_80%_at_50%_50%,color-mix(in_oklab,var(--fw-bg)_94%,transparent),transparent)]" />
      <Link href="/" className="self-start">
        <Logo />
      </Link>
      <div className="flex max-w-2xl flex-col items-center">
        <p className="font-display font-medium tracking-tight text-error-code text-ink">404</p>
        <h1 className="mt-6 font-display font-medium tracking-tight text-3xl text-ink sm:text-4xl">
          {NOT_FOUND.title}
        </h1>
        <p className="mt-4 max-w-md text-base text-muted sm:text-lg">{NOT_FOUND.body}</p>
        <Link href="/" className={`mt-8 ${buttonClasses({ size: BUTTON_SIZES.lg })}`}>
          {NOT_FOUND.action}
        </Link>
      </div>
    </main>
  );
}
