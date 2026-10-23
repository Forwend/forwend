"use client";

import { usePrivy } from "@privy-io/react-auth";
import { setupListeners } from "@reduxjs/toolkit/query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Provider } from "react-redux";
import { makeStore } from "@/store/store";

// A store belongs to one signed-in user: a user change or sign-out gets a fresh, empty store on that same
// render, so nobody sees another user's cached answers.
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
