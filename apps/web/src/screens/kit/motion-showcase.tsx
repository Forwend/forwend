"use client";

import {
  BUTTON_VARIANTS,
  Button,
  DotLoader,
  ProgressBar,
  Shimmer,
  Spinner,
  SuccessCheck,
} from "@forwend/ui-web";
import { useState } from "react";
import { KitGroup } from "@/screens/kit/kit-section";

export function MotionShowcase() {
  // Remounting the check replays its one-time drawing.
  const [run, setRun] = useState(0);
  return (
    <div className="flex flex-col gap-10">
      <KitGroup title="Spinner: short waits, inside buttons">
        <Spinner />
        <Spinner label="Saving" size="md" />
      </KitGroup>
      <KitGroup title="Dot loader: waiting for the network">
        <DotLoader />
      </KitGroup>
      <KitGroup title="Shimmer: content that is loading">
        <div className="flex w-full max-w-sm flex-col gap-2">
          <Shimmer className="h-5 w-2/3" />
          <Shimmer className="h-4 w-full" />
          <Shimmer className="h-4 w-5/6" />
        </div>
      </KitGroup>
      <KitGroup title="Progress bar: work of unknown length">
        <div className="w-full max-w-sm">
          <ProgressBar />
        </div>
      </KitGroup>
      <KitGroup title="Success check: settled, joined, saved">
        <SuccessCheck key={run} label="Settled" />
        <Button variant={BUTTON_VARIANTS.secondary} onClick={() => setRun((n) => n + 1)}>
          Play again
        </Button>
      </KitGroup>
      <p className="text-sm text-muted">All animations stop under prefers-reduced-motion.</p>
    </div>
  );
}
