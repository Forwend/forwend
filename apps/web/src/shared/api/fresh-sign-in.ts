import type {
  BaseQueryFn,
  FetchArgs,
  FetchBaseQueryError,
  FetchBaseQueryMeta,
} from "@reduxjs/toolkit/query";
import { apiError, errorStatus, HTTP_STATUS } from "@/shared/api/api-error";

/** The API's answer when an action needs a sign-in from the last 15 minutes. */
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

/** True for the API's reauth_required answer; a form shows no error for it once the user cancelled the sign-in. */
export const needsFreshSignIn = (error: unknown) =>
  errorStatus(error) === HTTP_STATUS.unauthorized && apiError(error).code === REAUTH_REQUIRED;

/** On reauth_required, waits for a fresh sign-in and resends once; concurrent requests share one dialog. */
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
