"use client";

import { PageError } from "@/shared/components/landscape-page/page-error";

const BODY = "This page failed to show. Your balances and payments are not affected.";

export default function AppError({ retry }: { retry: () => void }) {
  return <PageError body={BODY} retry={retry} />;
}
