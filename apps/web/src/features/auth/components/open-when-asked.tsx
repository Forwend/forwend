"use client";

import { useEffect, useRef } from "react";

export interface OpenWhenAskedProps {
  asked: number;
  open: () => void;
}

// Opening an open dialog throws, so only a new ask opens it.
export function OpenWhenAsked({ asked, open }: OpenWhenAskedProps) {
  const latest = useRef(open);
  latest.current = open;
  useEffect(() => {
    if (asked > 0) latest.current();
  }, [asked]);
  return null;
}
