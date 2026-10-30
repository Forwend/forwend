"use client";

import { type ReactNode, useRef } from "react";
import { useEmbedMessages } from "@/features/pay/hooks/use-embed-messages";

export interface EmbedFrameProps {
  linkToken: string;
  /** The page that frames the checkout; src/proxy.ts let only this origin frame it (R-168). */
  origin: string;
  children: ReactNode;
}

/** The embedded checkout's box: its height is what the framing page sizes the frame to. */
export function EmbedFrame({ linkToken, origin, children }: EmbedFrameProps) {
  const root = useRef<HTMLDivElement>(null);
  useEmbedMessages(root, linkToken, origin);
  return (
    <div ref={root} data-embed>
      {children}
    </div>
  );
}
