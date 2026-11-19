import { configureStore } from "@reduxjs/toolkit";
import { type ApiExtra, apiSlice } from "@/shared/api/api-slice";

// One store per browser tab, never a server-wide singleton; it holds only the API request cache.
export function makeStore(extra: ApiExtra) {
  return configureStore({
    reducer: { [apiSlice.reducerPath]: apiSlice.reducer },
    middleware: (getDefault) =>
      getDefault({ thunk: { extraArgument: extra } }).concat(apiSlice.middleware),
  });
}

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
