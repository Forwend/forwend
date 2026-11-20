"use client";

import { BUTTON_SIZES, Button } from "@forwend/ui-web";
import { LandscapePage } from "@/shared/components/landscape-page/landscape-page";

const PAGE_ERROR = {
  title: "Something went wrong.",
  retry: "Try again",
} as const;

/** A route's error page, laid out as the 404: what stays safe, and one way to render again. */
export function PageError({ body, retry }: { body: string; retry: () => void }) {
  return (
    <LandscapePage>
      <div role="alert" className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-balance text-ink">
          {PAGE_ERROR.title}
        </h1>
        <p className="text-muted">{body}</p>
        <Button size={BUTTON_SIZES.lg} className="mt-6 w-full" onClick={retry}>
          {PAGE_ERROR.retry}
        </Button>
      </div>
    </LandscapePage>
  );
}
