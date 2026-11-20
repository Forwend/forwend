"use client";

import { useState } from "react";

export interface StoredLogoProps {
  src: string;
  letter: string; // shown when the image fails
  className?: string;
}

/** A decorative logo from our own files, so no other site is asked; a failed image shows the letter. */
export function StoredLogo({ src, letter, className = "" }: StoredLogoProps) {
  // Remembered by file: another file's failure says nothing of this one.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src)
    return (
      <span
        aria-hidden
        className={`grid shrink-0 place-items-center rounded-pill bg-surface-2 text-xs font-medium text-muted ${className}`}
      >
        {letter}
      </span>
    );
  return (
    // biome-ignore lint/performance/noImgElement: a file of a few KB, already about the size it is drawn at
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailedSrc(src)}
      // A light disc keeps dark marks readable in the dark theme; a logo that is not square shows whole.
      className={`shrink-0 rounded-pill object-contain dark:bg-ink ${className}`}
    />
  );
}
