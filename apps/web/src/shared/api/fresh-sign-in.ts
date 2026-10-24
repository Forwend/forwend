import type {
  BaseQueryFn,
  FetchArgs,
  FetchBaseQueryError,
  FetchBaseQueryMeta,
} from "@reduxjs/toolkit/query";

/** The API's answer when an action needs a sign-in from the last 5 minutes (R-137, D-49). */
export const REAUTH_REQUIRED = "reauth_required";

type BaseQuery<Options> = BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError,
  Options,
  FetchBaseQueryMeta
>;

/** Asks the user to sign in again; true once they did, false when they cancel. */
export type AskFreshSignIn = () => Promise<boolean>;

const needsFreshSignIn = (error: FetchBaseQueryError | undefined) =>
  error?.status === 401 &&
  (error.data as { error?: { code?: string } } | undefined)?.error?.code === REAUTH_REQUIRED;

/** On reauth_required, waits for a fresh sign-in, then sends the request once more with the new token. Requests that
 * hit it together share one dialog. */
export function withFreshSignIn<Options>(
  base: BaseQuery<Options>,
  ask: (extra: unknown) => AskFreshSignIn | undefined,
): BaseQuery<Options> {
  let asking: Promise<boolean> | null = null;
  return async (args, api, extra) => {
    const result = await base(args, api, extra);
    const askUser = ask(api.extra);
    if (!needsFreshSignIn(result.error) || !askUser) return result;
    asking ??= askUser().finally(() => {
      asking = null;
    });
    return (await asking) ? base(args, api, extra) : result;
  };
}
