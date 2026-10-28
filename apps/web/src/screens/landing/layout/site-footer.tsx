import { BrandIcon, Logo } from "@forwend/ui-web";
import { FOOTER, LANDING_SECTIONS, NAV_LINKS } from "@/screens/landing/constants/landing-content";
import { FooterRidges } from "@/shared/components/art/footer-ridges";
import { SITE } from "@/shared/config/site";

export function SiteFooter() {
  return (
    <footer data-section={LANDING_SECTIONS.footer} className="relative isolate overflow-hidden">
      <FooterRidges className="absolute inset-x-0 bottom-0 -z-10 h-24 w-full sm:h-40 lg:h-56" />
      <div className="mx-auto max-w-7xl fw-safe-x pt-12 pb-28 sm:[--fw-page-gutter:2rem] lg:[--fw-page-gutter:2.5rem] sm:pb-44 lg:pb-60">
        <div className="flex flex-col gap-10 md:flex-row md:justify-between">
          <div className="max-w-xs">
            <Logo className="text-lg" />
            <p className="mt-2 text-muted">{FOOTER.tagline}</p>
            <div className="mt-6 flex items-center gap-4 text-subtle">
              <ul aria-label="Social channels" className="flex gap-3">
                {FOOTER.socials.map((social) => (
                  <li key={social.name}>
                    <BrandIcon
                      name={social.icon}
                      label={social.name}
                      className="size-[var(--fw-icon-md)]"
                    />
                  </li>
                ))}
              </ul>
              <span className="text-sm">{FOOTER.socialsSoon}</span>
            </div>
          </div>
          <nav aria-label="Footer">
            <ul className="grid grid-cols-2 gap-x-12 text-ink">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className="inline-flex min-h-11 items-center hover:underline">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="mt-12 flex flex-col gap-3 border-t border-line pt-6 text-sm text-muted sm:flex-row sm:justify-between">
          <p>© 2026 {SITE.name}</p>
          <ul className="flex gap-6">
            {FOOTER.legal.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
