import { FooterRidges } from "@/components/art/footer-ridges";
import { FOOTER, LANDING_SECTIONS, NAV_LINKS } from "@/constants/landing";
import { SITE } from "@/constants/site";

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
            <p className="text-lg font-semibold tracking-tight text-ink">{SITE.name}</p>
            <p className="mt-2 text-muted">{FOOTER.tagline}</p>
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
