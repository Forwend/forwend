import { BUTTON_SIZES, buttonClasses, Logo, NavPill, ThemeSwitch } from "@forwend/ui-web";
import { CTA } from "@/constants/copy";
import { LANDING_SECTIONS, NAV_LINKS } from "@/constants/landing";

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
            <ThemeSwitch className="size-8 border-transparent bg-transparent shadow-none" />
            <a href="#join" className={buttonClasses({ size: BUTTON_SIZES.sm })}>
              {CTA.joinWaitlist}
            </a>
          </span>
        }
      />
    </header>
  );
}
