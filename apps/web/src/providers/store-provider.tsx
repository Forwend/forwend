"use client";

import { usePrivy } from "@privy-io/react-auth";
import { setupListeners } from "@reduxjs/toolkit/query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Provider } from "react-redux";
import { makeStore } from "@/store/store";

// Inside Privy: requests take the current access token. setupListeners lets queries read again when the tab comes
// back into view.
export function StoreProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { getAccessToken } = usePrivy();
  const token = useRef(getAccessToken);
  useEffect(() => {
    token.current = getAccessToken;
  }, [getAccessToken]);
  const [store] = useState(() => makeStore({ getAccessToken: () => token.current() }));
  useEffect(() => setupListeners(store.dispatch), [store]);
  return <Provider store={store}>{children}</Provider>;
}
