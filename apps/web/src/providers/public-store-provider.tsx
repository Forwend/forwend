"use client";

import { setupListeners } from "@reduxjs/toolkit/query";
import { type ReactNode, useEffect, useState } from "react";
import { Provider } from "react-redux";
import { makeStore } from "@/store/store";

// For public pages (checkout): the same request cache with no sign-in, so requests carry no token and Privy never
// loads. setupListeners lets queries read again when the tab comes back.
export function PublicStoreProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [store] = useState(() => makeStore({ getAccessToken: async () => null }));
  useEffect(() => setupListeners(store.dispatch), [store]);
  return <Provider store={store}>{children}</Provider>;
}
