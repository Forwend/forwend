"use client";

import { PageError } from "@/shared/components/landscape-page/page-error";

const BODY = "This page failed to show. A payment you already sent is not affected.";

export default function CheckoutError({ retry }: { retry: () => void }) {
  return <PageError body={BODY} retry={retry} />;
}
