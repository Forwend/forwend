import { BrandIcon, Logo, Tooltip } from "@forwend/ui-web";
import { FOOTER, LANDING_SECTIONS, NAV_LINKS } from "@/screens/landing/landing-content";
import { FooterRidges } from "@/shared/art/footer-ridges";
import { SITE } from "@/shared/config/site";

export function SiteFooter() {
  return (
    <footer
      data-section={LANDING_SECTIONS.footer}
      className="relative isolate mt-24 overflow-hidden"
    >
      <FooterRidges className="absolute inset-x-0 bottom-0 -z-10 h-56 w-full" />
      <div className="mx-auto max-w-6xl px-4 pt-12 pb-60 sm:px-8">
        <div className="flex flex-col gap-10 md:flex-row md:justify-between">
          <div className="max-w-xs">
            <Logo className="text-lg" />
            <p className="mt-2 text-muted">{FOOTER.tagline}</p>
            {/* Not links yet: each shows "Coming soon" on hover and keyboard focus. */}
            <ul aria-label="Social channels" className="mt-6 flex gap-2">
              {FOOTER.socials.map((social) => (
                <li key={social.name}>
                  <Tooltip content={FOOTER.socialsSoon} side="bottom">
                    <button
                      type="button"
                      aria-disabled="true"
                      aria-label={social.name}
                      className="flex size-10 cursor-default items-center justify-center rounded-pill border border-line text-muted transition-colors duration-[var(--fw-duration-fast)] hover:border-line-strong hover:text-ink"
                    >
                      <BrandIcon name={social.icon} className="size-[var(--fw-icon-md)]" />
                    </button>
                  </Tooltip>
                </li>
              ))}
            </ul>
          </div>
          <nav aria-label="Footer">
            <ul className="grid grid-cols-2 gap-x-12 gap-y-3 text-ink">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className="hover:underline">
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
