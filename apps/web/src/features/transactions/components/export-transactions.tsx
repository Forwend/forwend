"use client";

import { BUTTON_VARIANTS, Button, DateRangePicker, Dialog } from "@forwend/ui-web";
import { Download } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { BILLING_THEN } from "@/features/profiles/constants/profile";
import { billingDetailsHref } from "@/features/profiles/lib/profile";
import {
  recordsCurrencySaveKey,
  useDownloadStatementMutation,
  useGetRecordsCurrencyQuery,
  useLazyExportTransactionsQuery,
  useSetRecordsCurrencyMutation,
} from "@/features/transactions/api/transactions-api";
import { RecordsCurrency } from "@/features/transactions/components/records-currency";
import { TOO_MANY_TRANSACTIONS } from "@/features/transactions/constants/transactions";
import { TRANSACTIONS_COPY as COPY } from "@/features/transactions/constants/transactions-copy";
import { apiError, notFound } from "@/shared/api/api-error";

const tooMany = (failure: unknown) => apiError(failure).code === TOO_MANY_TRANSACTIONS;

export interface ExportTransactionsProps {
  profileId: string;
  disabled: boolean;
}

export function ExportTransactions({ profileId, disabled }: ExportTransactionsProps) {
  const [exportCsv, { isFetching }] = useLazyExportTransactionsQuery();
  const [statement, statementState] = useDownloadStatementMutation();
  const currency = useGetRecordsCurrencyQuery(profileId);
  const [, savingCurrency] = useSetRecordsCurrencyMutation({
    fixedCacheKey: recordsCurrencySaveKey(profileId),
  });
  const currencyReady =
    currency.currentData !== undefined &&
    !currency.isFetching &&
    !currency.isError &&
    !savingCurrency.isLoading &&
    !savingCurrency.isError;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [dayError, setDayError] = useState("");
  const [error, setError] = useState("");
  // The dialog keeps its content while closed: each opening remounts the currency field.
  const [opened, setOpened] = useState(0);
  const actions = useRef<HTMLFormElement>(null);
  const days = useRef<HTMLDivElement>(null);

  const save = (url: string, name: string) => {
    Object.assign(document.createElement("a"), { href: url, download: name }).click();
    URL.revokeObjectURL(url);
    actions.current?.closest("dialog")?.close();
  };

  const checkDays = (statementDays: boolean) => {
    const shown = statementDays && (!from || !to) ? COPY.statementDays : "";
    flushSync(() => {
      setDayError(shown);
      setError("");
    });
    if (!shown) return true;
    days.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    return false;
  };

  const downloadStatement = async () => {
    if (!currencyReady || !checkDays(true)) return;
    try {
      save(await statement({ profileId, from, to }).unwrap(), COPY.statementFile(from, to));
    } catch (failure) {
      setError(
        notFound(failure)
          ? COPY.statementNeedsBilling
          : tooMany(failure)
            ? COPY.tooManyTransactions
            : COPY.statementFailed,
      );
    }
  };

  const download = async () => {
    if (!currencyReady || !checkDays(false)) return;
    try {
      const csv = await exportCsv({
        profileId,
        from: from || undefined,
        to: to || undefined,
      }).unwrap();
      save(URL.createObjectURL(new Blob([csv], { type: "text/csv" })), COPY.csvFile);
    } catch (failure) {
      setError(tooMany(failure) ? COPY.tooManyTransactions : COPY.exportFailed);
    }
  };

  return (
    <Dialog
      triggerLabel={COPY.export}
      title={COPY.exportTitle}
      trigger={(open) => (
        <Button
          variant={BUTTON_VARIANTS.secondary}
          aria-label={COPY.export}
          onClick={() => {
            setError("");
            setDayError("");
            if (savingCurrency.isError) savingCurrency.reset();
            setOpened((n) => n + 1);
            open();
          }}
          disabled={disabled}
          className="max-sm:w-10 max-sm:px-0 max-sm:pointer-coarse:before:left-1/2 max-sm:pointer-coarse:before:w-11 max-sm:pointer-coarse:before:-translate-x-1/2"
        >
          <Download aria-hidden className="size-[var(--fw-icon-sm)]" />
          <span className="max-sm:sr-only">{COPY.export}</span>
        </Button>
      )}
    >
      <p>{COPY.exportText}</p>
      <div className="mt-4">
        <RecordsCurrency key={opened} profileId={profileId} />
      </div>
      <div ref={days} className="mt-4">
        <DateRangePicker
          label={COPY.exportPeriod}
          value={{ from: from || null, to: to || null }}
          note={COPY.periodNote}
          error={dayError || undefined}
          clearLabel={COPY.clearPeriod}
          onChange={(range) => {
            setFrom(range.from ?? "");
            setTo(range.to ?? "");
            setDayError("");
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
          {error === COPY.statementNeedsBilling ? (
            <>
              {" "}
              <Link
                href={billingDetailsHref(BILLING_THEN.transactions)}
                className="font-medium underline underline-offset-2"
              >
                {COPY.addBillingDetails}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      <form ref={actions} method="dialog" className="mt-5 flex flex-wrap justify-end gap-2">
        <Button type="submit" variant={BUTTON_VARIANTS.secondary}>
          {COPY.exportCancel}
        </Button>
        <Button
          type="button"
          variant={BUTTON_VARIANTS.secondary}
          loading={statementState.isLoading}
          disabled={!currencyReady}
          onClick={downloadStatement}
        >
          {COPY.downloadStatement}
        </Button>
        <Button type="button" loading={isFetching} disabled={!currencyReady} onClick={download}>
          {COPY.exportDownload}
        </Button>
      </form>
    </Dialog>
  );
}
