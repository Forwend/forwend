import { BUTTON_SIZES, buttonClasses, Logo, NavPill, ThemeSwitch } from "@forwend/ui-web";
import { CTA } from "@/features/waitlist/constants/waitlist";
import { LANDING_SECTIONS, NAV_LINKS } from "@/screens/landing/constants/landing-content";
import { SiteMenu } from "@/screens/landing/layout/site-menu";

export function SiteNav() {
  return (
    <header
      data-section={LANDING_SECTIONS.nav}
      className="fixed inset-x-0 top-[calc(1.25rem+env(safe-area-inset-top))] z-[var(--fw-z-nav)] fw-safe-x max-[22rem]:[--fw-page-gutter:.5rem] sm:top-[calc(1.5rem+env(safe-area-inset-top))]"
    >
      <NavPill
        brand={<Logo />}
        links={NAV_LINKS}
        action={
          <span className="flex items-center gap-1.5 max-[22rem]:gap-1">
            <SiteMenu />
            <ThemeSwitch className="relative size-8 border-transparent bg-transparent shadow-none! after:absolute after:-inset-x-0.75 after:-inset-y-1.5 pointer-coarse:size-8" />
            <a
              href="#join"
              className={`${buttonClasses({ size: BUTTON_SIZES.sm })} relative after:absolute after:-inset-x-0.75 after:-inset-y-1.5 max-[22rem]:px-2.5`}
            >
              {CTA.joinWaitlist}
            </a>
          </span>
        }
      />
    </header>
  );
}
