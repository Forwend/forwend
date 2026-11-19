"use client";

import { type ReactNode, useRef } from "react";
import { useEmbedMessages } from "@/features/pay/hooks/use-embed-messages";

export interface EmbedFrameProps {
  linkToken: string;
  origin: string;
  children: ReactNode;
}

export function EmbedFrame({ linkToken, origin, children }: EmbedFrameProps) {
  const root = useRef<HTMLDivElement>(null);
  useEmbedMessages(root, linkToken, origin);
  return (
    <div ref={root} data-embed>
      {children}
    </div>
  );
}
