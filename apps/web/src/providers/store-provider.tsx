"use client";

import { usePrivy } from "@privy-io/react-auth";
import { setupListeners } from "@reduxjs/toolkit/query";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Provider } from "react-redux";
import { FreshSignInProvider } from "@/features/auth/components/fresh-sign-in";
import type { AskFreshSignIn } from "@/shared/api/fresh-sign-in";
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
  // R-137: a request that needs a fresh sign-in asks through the provider below.
  const ask = useRef<AskFreshSignIn>(async () => false);
  const register = useCallback((fn: AskFreshSignIn) => {
    ask.current = fn;
  }, []);
  const newStore = () =>
    makeStore({ getAccessToken: () => token.current(), freshSignIn: () => ask.current() });
  const [owned, setOwned] = useState(() => ({ userId, store: newStore() }));
  let { store } = owned;
  if (owned.userId !== userId) {
    store = newStore();
    setOwned({ userId, store });
  }
  useEffect(() => setupListeners(store.dispatch), [store]);
  return (
    <Provider store={store}>
      <FreshSignInProvider register={register}>{children}</FreshSignInProvider>
    </Provider>
  );
}
