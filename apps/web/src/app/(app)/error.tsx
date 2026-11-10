"use client";

import { SIGN_IN_COPY } from "@/features/auth/constants/sign-in";
import { PageError } from "@/shared/components/landscape-page/page-error";

const BODY = "This page failed to show. Your balances and payments are not affected.";

export default function AppError({ retry }: { retry: () => void }) {
  return <PageError homeLabel={SIGN_IN_COPY.homeLabel} body={BODY} retry={retry} />;
}
