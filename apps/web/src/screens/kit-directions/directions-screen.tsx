import Image from "next/image";
import type { ComponentType } from "react";
import { DawnPathComp } from "@/screens/kit-directions/dawn-path-comp";
import { directionFontVars } from "@/screens/kit-directions/direction-fonts";
import { DIRECTION_IDS, DIRECTIONS, type DirectionId } from "@/screens/kit-directions/directions";
import { DuskLedgerComp } from "@/screens/kit-directions/dusk-ledger-comp";
import { HalftoneHorizonComp } from "@/screens/kit-directions/halftone-horizon-comp";
import { ImageComp } from "@/screens/kit-directions/image-comp";
import { IMAGE_DIRECTIONS } from "@/screens/kit-directions/image-directions";

const COMPS: Record<DirectionId, ComponentType> = {
  [DIRECTION_IDS.dawnPath]: DawnPathComp,
  [DIRECTION_IDS.duskLedger]: DuskLedgerComp,
  [DIRECTION_IDS.halftoneHorizon]: HalftoneHorizonComp,
};

export function DirectionsScreen() {
  return (
    <main className={`${directionFontVars} mx-auto max-w-[90rem] px-3 py-10 font-sans sm:px-6`}>
      <h1 className="text-2xl font-semibold tracking-tight">Visual directions</h1>
      <p className="mt-2 max-w-2xl text-pretty opacity-75">
        Hero comps on one page, each with its image below. Pick one; it becomes the design tokens.
      </p>
      <div className="mt-10 flex flex-col gap-16">
        {DIRECTIONS.map((d) => {
          const Comp = COMPS[d.id];
          return (
            <section key={d.id} data-testid={`direction-${d.id}`} aria-labelledby={`${d.id}-label`}>
              <h2 id={`${d.id}-label`} className="text-lg font-semibold">
                {d.letter} {d.name}
              </h2>
              <p className="mt-1 mb-4 text-sm opacity-75">{d.summary}</p>
              <Comp />
              <figure className="mt-4">
                <Image
                  src={d.image.src}
                  width={d.image.width}
                  height={d.image.height}
                  alt={`Hero image for ${d.name}`}
                  sizes="(min-width: 1440px) 1392px, 100vw"
                  className="h-auto w-full rounded-xl"
                />
              </figure>
            </section>
          );
        })}
        {IMAGE_DIRECTIONS.map((d) => (
          <section key={d.id} data-testid={`direction-${d.id}`} aria-labelledby={`${d.id}-label`}>
            <h2 id={`${d.id}-label`} className="text-lg font-semibold">
              {d.letter} {d.name}
            </h2>
            <p className="mt-1 mb-4 text-sm opacity-75">{d.summary}</p>
            <ImageComp name={d.name} image={d.image} comp={d.comp} />
          </section>
        ))}
      </div>
    </main>
  );
}
