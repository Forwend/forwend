import { BUTTON_SIZES, buttonClasses, Logo, NavPill, ThemeSwitch } from "@forwend/ui-web";
import { CTA } from "@/features/waitlist/waitlist";
import { LANDING_SECTIONS, NAV_LINKS } from "@/screens/landing/landing-content";
import { SiteMenu } from "@/screens/landing/layout/site-menu";

export function SiteNav() {
  return (
    <header
      data-section={LANDING_SECTIONS.nav}
      className="fixed inset-x-0 top-5 z-[var(--fw-z-nav)] px-4 sm:top-6"
    >
      <NavPill
        brand={<Logo />}
        links={NAV_LINKS}
        action={
          <span className="flex items-center gap-1.5">
            <SiteMenu />
            <ThemeSwitch className="relative size-8 border-transparent bg-transparent shadow-none! after:absolute after:-inset-x-0.75 after:-inset-y-1.5 pointer-coarse:size-8" />
            <a
              href="#join"
              className={`${buttonClasses({ size: BUTTON_SIZES.sm })} relative after:absolute after:-inset-x-0.75 after:-inset-y-1.5`}
            >
              {CTA.joinWaitlist}
            </a>
          </span>
        }
      />
    </header>
  );
}
