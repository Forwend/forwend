"use client";

import { setupListeners } from "@reduxjs/toolkit/query";
import { type ReactNode, useEffect, useState } from "react";
import { Provider } from "react-redux";
import { makeStore } from "@/store/store";

// Public pages: no sign-in, so requests carry no token and Privy never loads.
export function PublicStoreProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [store] = useState(() => makeStore({ getAccessToken: async () => null }));
  useEffect(() => setupListeners(store.dispatch), [store]);
  return <Provider store={store}>{children}</Provider>;
}
