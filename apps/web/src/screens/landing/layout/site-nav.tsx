import { BUTTON_SIZES, buttonClasses, Logo, NavPill, ThemeSwitch } from "@forwend/ui-web";
import Link from "next/link";
import { CTA } from "@/features/waitlist/constants/waitlist";
import { LANDING_SECTIONS, NAV_LINKS, SIGN_IN } from "@/screens/landing/constants/landing-content";
import { SiteMenu } from "@/screens/landing/layout/site-menu";
import { APP_ROUTES } from "@/shared/config/routes";

export function SiteNav() {
  return (
    <header
      data-section={LANDING_SECTIONS.nav}
      className="fixed inset-x-0 top-0 z-[var(--fw-z-nav)] border-b border-line bg-[color-mix(in_oklab,var(--fw-bg)_88%,transparent)] pt-[env(safe-area-inset-top)] backdrop-blur-glass fw-safe-x max-[22rem]:[--fw-page-gutter:.5rem] sm:[--fw-page-gutter:2rem] lg:[--fw-page-gutter:2.5rem]"
    >
      <NavPill
        brand={<Logo />}
        links={NAV_LINKS}
        action={
          <span className="flex items-center gap-1.5 max-[22rem]:gap-1">
            <SiteMenu />
            <ThemeSwitch className="relative size-9 border-transparent bg-transparent after:absolute after:-inset-1 pointer-coarse:size-9" />
            <Link
              href={APP_ROUTES.signIn}
              className={`${buttonClasses({ size: BUTTON_SIZES.md, variant: "ghost" })} max-sm:hidden`}
            >
              {SIGN_IN}
            </Link>
            <a
              href="#join"
              className={`${buttonClasses({ size: BUTTON_SIZES.md })} max-[22rem]:px-2.5`}
            >
              {CTA.joinWaitlist}
            </a>
          </span>
        }
      />
    </header>
  );
}
