import { THEMES } from "@forwend/design-tokens";
import { Logo, LogoMark } from "@forwend/ui-web";
import Image from "next/image";
import type { OnGroundProps } from "@/types/kit/props";
import { KitGroup } from "./kit-section";

const MARK_SIZES = ["size-4", "size-6", "size-10", "size-16"] as const;
const FAVICON_SIZES = [16, 32, 48] as const;

function OnGround({ theme, children }: OnGroundProps) {
  // A local data-theme shows each variant on the real light and dark grounds.
  return (
    <div
      data-theme={theme}
      className="flex min-w-60 flex-1 flex-wrap items-center gap-6 rounded-lg border border-line bg-bg p-6 text-ink"
    >
      {children}
    </div>
  );
}

export function LogoShowcase() {
  return (
    <div className="flex flex-col gap-10">
      {[THEMES.light, THEMES.dark].map((theme) => (
        <KitGroup key={theme} title={`On ${theme}`}>
          <div className="flex w-full flex-wrap gap-4">
            <OnGround theme={theme}>
              <Logo />
              <Logo className="text-2xl [&_svg]:size-9" />
            </OnGround>
            <OnGround theme={theme}>
              {MARK_SIZES.map((size) => (
                <LogoMark key={size} className={size} label="Forwend" />
              ))}
            </OnGround>
          </div>
        </KitGroup>
      ))}
      <KitGroup title="App icon and favicons">
        <Image src="/icon-512.png" alt="Forwend app icon" width={96} height={96} />
        <Image
          src="/icon-maskable-512.png"
          alt="Forwend maskable icon"
          width={96}
          height={96}
          className="rounded-pill"
        />
        <div className="flex items-end gap-4">
          {FAVICON_SIZES.map((size) => (
            <span key={size} className="flex flex-col items-center gap-2">
              <Image src="/icon-192.png" alt={`Favicon at ${size}px`} width={size} height={size} />
              <code className="font-mono text-xs text-subtle">{size}px</code>
            </span>
          ))}
        </div>
      </KitGroup>
      <p className="text-sm text-muted">
        Files: /brand/forwend-mark.svg (one color), /brand/forwend-icon.svg (tile), favicon.ico,
        apple-icon.png, icon-192/512.png.
      </p>
    </div>
  );
}
