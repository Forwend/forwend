"use client";

import { usePrivy } from "@privy-io/react-auth";
import { setupListeners } from "@reduxjs/toolkit/query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Provider } from "react-redux";
import { makeStore } from "@/store/store";

// Inside Privy: requests take the current access token. A store belongs to one signed-in user: when the user changes
// or signs out, by the Sign out button or because the session ended, the next render already has a fresh, empty
// store, so nobody sees another user's cached answers. setupListeners lets queries read again when the tab comes back.
export function StoreProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { getAccessToken, user } = usePrivy();
  const userId = user?.id ?? null;
  const token = useRef(getAccessToken);
  useEffect(() => {
    token.current = getAccessToken;
  }, [getAccessToken]);
  const newStore = () => makeStore({ getAccessToken: () => token.current() });
  const [owned, setOwned] = useState(() => ({ userId, store: newStore() }));
  let { store } = owned;
  if (owned.userId !== userId) {
    store = newStore();
    setOwned({ userId, store });
  }
  useEffect(() => setupListeners(store.dispatch), [store]);
  return <Provider store={store}>{children}</Provider>;
}
