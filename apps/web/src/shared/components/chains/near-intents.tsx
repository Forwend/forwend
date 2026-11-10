import { BrandIcon } from "@forwend/ui-web";

/** NEAR Intents by name: NEAR's mark, then the words, in the text's own size. Never a wordmark image. */
export function NearIntents() {
  return (
    <span className="inline-flex items-center gap-[0.4em] font-medium whitespace-nowrap text-ink">
      <BrandIcon name="near" className="size-[1em]" />
      NEAR Intents
    </span>
  );
}

/** The credit under a conversion: centered and quiet, so the amount above it stays the first read. */
export function PoweredByNearIntents() {
  return (
    <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
      Powered by <NearIntents />
    </p>
  );
}
