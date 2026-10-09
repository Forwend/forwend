import Image from "next/image";
import { CTA } from "@/features/waitlist/waitlist";
import { compVars, NAV_VARIANTS } from "@/screens/kit-directions/comp";
import { CompNav } from "@/screens/kit-directions/comp-nav";
import type { ImageCompSpec } from "@/screens/kit-directions/directions";
import { InvoicePanel } from "@/screens/kit-directions/invoice-panel";

interface ImageCompProps {
  name: string;
  image: { src: string; width: number; height: number };
  comp: ImageCompSpec;
}

const LAYOUT = {
  center: { copy: "mx-auto mt-20 max-w-2xl items-center text-center", panel: "mx-auto mt-auto" },
  left: { copy: "mt-20 max-w-xl items-start text-left", panel: "mt-auto ml-auto" },
  split: {
    copy: "mt-24 max-w-lg items-start text-left lg:mt-32",
    panel: "mt-auto ml-auto lg:-mt-40",
  },
} as const;

// One comp for every data-driven direction: the image fills the frame, the palette and face change.
export function ImageComp({ image, comp, name }: ImageCompProps) {
  const layout = LAYOUT[comp.layout];
  return (
    <div
      style={compVars(comp.palette)}
      className="relative isolate flex min-h-[46rem] flex-col overflow-hidden rounded-[1.75rem] px-4 pt-5 pb-8 text-[var(--ink)] sm:px-8"
    >
      <Image
        src={image.src}
        alt=""
        fill
        sizes="(min-width: 1440px) 1392px, 100vw"
        className="-z-20 object-cover"
      />
      <div className="absolute inset-0 -z-10" style={{ background: comp.scrim }} />
      <CompNav variant={NAV_VARIANTS.bar} />
      <div className={`flex flex-col ${layout.copy}`}>
        <h3
          className="text-[clamp(2.4rem,5.6vw,4.6rem)] leading-[1.02] tracking-[-0.02em] text-balance"
          style={{ fontFamily: `var(${comp.fontVar})` }}
        >
          {comp.headline}
        </h3>
        <p className="mt-5 text-lg text-[var(--muted)] text-pretty">{comp.body}</p>
        <button
          type="button"
          aria-label={`${CTA.joinWaitlist} (${name} sample)`}
          className="mt-8 rounded-full bg-[var(--accent)] px-6 py-3 font-medium text-[var(--onInk)]"
        >
          {CTA.joinWaitlist}
        </button>
      </div>
      <InvoicePanel className={layout.panel} />
    </div>
  );
}
