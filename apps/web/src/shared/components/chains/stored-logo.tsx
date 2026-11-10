"use client";

import { useState } from "react";

export interface StoredLogoProps {
  /** A logo file the web ships, such as "/logos/tokens/aave.webp". */
  src: string;
  /** Stands in when the image does not load: the first letter of what it marks. */
  letter: string;
  className?: string;
}

/** A token or network logo from the files the web ships, so the page asks no other site for it. Decorative: the text
 * beside it names what it marks. An image that fails gives its place to the letter, never to a broken picture. */
export function StoredLogo({ src, letter, className = "" }: StoredLogoProps) {
  const [failed, setFailed] = useState(false);
  if (failed)
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
      onError={() => setFailed(true)}
      // Many logos are a dark mark on nothing: in the dark theme a light disc keeps them readable.
      className={`shrink-0 rounded-pill object-cover dark:bg-ink ${className}`}
    />
  );
}
