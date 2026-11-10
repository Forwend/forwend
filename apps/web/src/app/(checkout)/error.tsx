"use client";

import { SIGN_IN_COPY } from "@/features/auth/constants/sign-in";
import { PageError } from "@/shared/components/landscape-page/page-error";

// The page only shows the payment; the chain and the API keep it, so an error here loses nothing already sent.
const BODY = "This page failed to show. A payment you already sent is not affected.";

export default function CheckoutError({ retry }: { retry: () => void }) {
  return <PageError homeLabel={SIGN_IN_COPY.homeLabel} body={BODY} retry={retry} />;
}
