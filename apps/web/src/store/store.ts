import { configureStore } from "@reduxjs/toolkit";
import { type ApiExtra, apiSlice } from "@/shared/api/api-slice";

// One store per browser tab, made by StoreProvider; never a server-wide singleton. It holds only the request cache:
// API answers are plain JSON with amounts as strings, so the state stays serializable and money stays exact.
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
