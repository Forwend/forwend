"use client";

import { Skeleton } from "@forwend/ui-web";
import { ShieldAlert } from "lucide-react";
import { notFound } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  invoicesApi,
  useCountViewMutation,
  useGetInvoiceQuery,
  usePickOptionMutation,
} from "@/features/invoices/api/invoices-api";
import type { Invoice } from "@/features/invoices/types/invoices";
import { Backdrop } from "@/features/pay/components/backdrop";
import { Closes } from "@/features/pay/components/closes";
import { LoadFailed } from "@/features/pay/components/load-failed";
import type { Choice } from "@/features/pay/components/option-picker";
import { PayBox } from "@/features/pay/components/pay-box";
import { PaySummary } from "@/features/pay/components/pay-summary";
import { PayTerms } from "@/features/pay/components/pay-terms";
import { EMBED_LAYOUTS } from "@/features/pay/constants/embed";
import { LEFT_PAD, RIGHT_PAD } from "@/features/pay/constants/pay";
import { PAY_COPY as COPY } from "@/features/pay/constants/pay-copy";
import { crossChainTarget } from "@/features/pay/lib/crosschain";
import {
  clockRuns,
  firstPaymentOption,
  payFinal,
  payState,
  payToken,
  withOption,
} from "@/features/pay/lib/pay";
import { checkedReceiveAddress } from "@/features/pay/lib/receive-address";
import { readTab, shownKey } from "@/features/pay/lib/tab-memory";
import type { EmbedLayout } from "@/features/pay/types/pay";
import { errorStatus, HTTP_STATUS } from "@/shared/api/api-error";
import { ServerStrip } from "@/shared/components/server-strip";
import { LIVE_QUERY, REFRESH_MS } from "@/shared/config/refresh";
import { useNow } from "@/shared/hooks/use-now";

export interface PayInvoiceProps {
  linkToken: string;
  option?: string;
  preview?: boolean;
  embed?: EmbedLayout;
}

export function PayInvoice({ linkToken, option, preview = false, embed }: PayInvoiceProps) {
  // Back then Forward finds an older read in the shared store: read again once it is a refresh old.
  const cached = invoicesApi.endpoints.getInvoice.useQueryState(linkToken);
  const invoice = useGetInvoiceQuery(linkToken, {
    ...LIVE_QUERY,
    pollingInterval: cached.data && payFinal(cached.data) ? 0 : REFRESH_MS,
    refetchOnMountOrArgChange: REFRESH_MS / 1000,
  });
  const [countView] = useCountViewMutation();
  // One view per load: the ref holds across React's dev double mount.
  const counted = useRef(false);
  useEffect(() => {
    if (counted.current || preview) return;
    counted.current = true;
    countView(linkToken);
  }, [countView, linkToken, preview]);
  if (invoice.data) {
    // A failed poll keeps the last read: say so, or a payer may think nothing arrived and pay again.
    const stale = invoice.error ? (
      <div data-stale className="lg:col-span-2">
        <ServerStrip className="lg:rounded-none" />
      </div>
    ) : null;
    return (
      <Loaded
        invoice={invoice.data}
        linkToken={linkToken}
        option={option}
        preview={preview}
        stale={stale}
        readAt={invoice.fulfilledTimeStamp ?? null}
        embed={embed}
      />
    );
  }
  if (errorStatus(invoice.error) === HTTP_STATUS.notFound) notFound();
  if (invoice.isError) return <LoadFailed onRetry={invoice.refetch} />;
  return <PaySkeleton />;
}

function Loaded({
  invoice: answer,
  linkToken,
  option,
  preview,
  stale,
  readAt,
  embed,
}: {
  invoice: Invoice;
  linkToken: string;
  option?: string;
  preview: boolean;
  stale: ReactNode;
  readAt: number | null;
  embed?: EmbedLayout;
}) {
  const choosing = !answer.optionLocked && answer.options.length > 1 && !firstPaymentOption(answer);
  // Loaded mounts only once the client has the read, so storage can be read while rendering.
  const [tabShown] = useState(() => readTab(shownKey(answer.invoiceId)));
  // This tab's pick comes first: the owner's preview keeps none on the invoice, and a keep can fail.
  const kept = choosing && !option ? (tabShown ?? answer.pickedOptionId ?? null) : null;
  const [picked, setPicked] = useState(option?.toLowerCase() ?? kept ?? undefined);
  const [pickOption] = usePickOptionMutation();
  const keep =
    choosing && !preview && !option
      ? (optionId: string) => void pickOption({ payToken: linkToken, optionId })
      : undefined;
  const invoice = useMemo(() => withOption(answer, picked), [answer, picked]);
  // The shown option's clock, not the invoice's.
  const now = useNow(clockRuns(invoice) ? Number.POSITIVE_INFINITY : 0);
  const address = useMemo(() => checkedReceiveAddress(invoice, linkToken), [invoice, linkToken]);
  const crossTarget = useMemo(() => crossChainTarget(answer, linkToken), [answer, linkToken]);
  const token = payToken(invoice);
  const choice: Choice | null = choosing
    ? {
        options: answer.options,
        picked: answer.options.find((o) => o.optionId === picked)?.optionId,
        onPick: setPicked,
      }
    : null;

  if (!address || !token) {
    return (
      <p
        role="alert"
        className="flex items-start gap-3 rounded-md bg-danger-soft px-4 py-3 text-danger lg:col-span-2"
      >
        <ShieldAlert aria-hidden className="size-[var(--fw-icon-md)] shrink-0" />
        {address ? COPY.unknownToken : COPY.mismatch}
      </p>
    );
  }
  const pay = payState(invoice, now);
  return (
    <>
      <Backdrop color={invoice.brand?.color} />
      {stale}
      <div className={`contents lg:flex lg:flex-col lg:gap-6 lg:pt-8 ${LEFT_PAD}`}>
        <PaySummary
          invoice={invoice}
          token={token}
          pay={pay}
          picking={choice !== null && !choice.picked}
        />
        {embed === EMBED_LAYOUTS.element ? null : (
          <PayTerms invoice={invoice} linkToken={linkToken} />
        )}
      </div>
      <div
        className={`order-2 flex min-w-0 flex-col gap-4 lg:self-stretch lg:py-8 lg:pl-16 ${RIGHT_PAD}`}
      >
        {pay.canSend ? <Closes invoice={invoice} now={now} /> : null}
        <div className="lg:my-auto">
          <PayBox
            invoice={invoice}
            linkToken={linkToken}
            address={address}
            token={token}
            pay={pay}
            now={now}
            readAt={readAt}
            choice={choice}
            tabShown={tabShown}
            kept={kept}
            keep={keep}
            embed={embed}
            crossTarget={crossTarget}
            preview={preview}
          />
        </div>
      </div>
    </>
  );
}

function PaySkeleton() {
  return (
    <>
      <Backdrop />
      <span role="status" className="sr-only">
        {COPY.loading}
      </span>
      <div aria-busy="true" className={`contents lg:flex lg:flex-col lg:gap-6 lg:pt-8 ${LEFT_PAD}`}>
        <div className="order-1 flex flex-col gap-5 lg:gap-6">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-md sm:size-11" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-9 w-48" />
          </div>
        </div>
      </div>
      <div
        aria-hidden
        className={`order-2 flex min-w-0 flex-col gap-4 lg:self-stretch lg:py-8 lg:pl-16 ${RIGHT_PAD}`}
      >
        <div className="lg:my-auto">
          <div className="fw-panel flex flex-col gap-4 p-4 sm:p-5">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        </div>
      </div>
    </>
  );
}
