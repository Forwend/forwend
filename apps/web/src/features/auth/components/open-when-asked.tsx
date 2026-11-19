"use client";

import { useEffect, useRef } from "react";

export interface OpenWhenAskedProps {
  asked: number;
  open: () => void;
}

// A dialog's trigger for a dialog a request opens, not a button: each ask opens it once. open is new on every render,
// and opening an open dialog throws, so only a new ask runs it.
export function OpenWhenAsked({ asked, open }: OpenWhenAskedProps) {
  const latest = useRef(open);
  latest.current = open;
  useEffect(() => {
    if (asked > 0) latest.current();
  }, [asked]);
  return null;
}
