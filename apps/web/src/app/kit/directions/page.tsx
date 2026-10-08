import type { ComponentType } from "react";
import { DawnPathComp } from "@/components/directions/dawn-path-comp";
import { DuskLedgerComp } from "@/components/directions/dusk-ledger-comp";
import { HalftoneHorizonComp } from "@/components/directions/halftone-horizon-comp";
import { DIRECTION_IDS, DIRECTIONS } from "@/constants/directions";
import { directionFontVars } from "@/lib/direction-fonts";
import type { DirectionId } from "@/types/kit/directions";

const COMPS: Record<DirectionId, ComponentType> = {
  [DIRECTION_IDS.dawnPath]: DawnPathComp,
  [DIRECTION_IDS.duskLedger]: DuskLedgerComp,
  [DIRECTION_IDS.halftoneHorizon]: HalftoneHorizonComp,
};

export default function DirectionsPage() {
  return (
    <main className={`${directionFontVars} mx-auto max-w-[90rem] px-3 py-10 font-sans sm:px-6`}>
      <h1 className="text-2xl font-semibold tracking-tight">Visual directions</h1>
      <p className="mt-2 max-w-2xl text-pretty opacity-75">
        Three hero comps on one page. Landscape art is drawn in code until the Grok images are
        available. Pick one; it becomes the design tokens.
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
            </section>
          );
        })}
      </div>
    </main>
  );
}
