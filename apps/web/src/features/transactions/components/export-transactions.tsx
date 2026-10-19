"use client";

import { BUTTON_VARIANTS, Button, Dialog, TextField } from "@forwend/ui-web";
import { Download } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { BILLING_THEN } from "@/features/profiles/constants/profile";
import {
  useDownloadStatementMutation,
  useLazyExportTransactionsQuery,
} from "@/features/transactions/api/transactions-api";
import { RecordsCurrency } from "@/features/transactions/components/records-currency";
import { TRANSACTIONS_COPY as COPY } from "@/features/transactions/constants/transactions-copy";
import { APP_ROUTES } from "@/shared/config/routes";

const NOT_FOUND = 404;

export interface ExportTransactionsProps {
  profileId: string;
  disabled: boolean;
}

// R-109: every transaction in the UTC days chosen, as the API's CSV (R-108); an empty day sets no limit. The same days
// give the income statement (R-113), which needs both. The days are the browser's date fields: the kit's calendar
// opens inside its field, and the dialog's scrolling body cuts it off.
export function ExportTransactions({ profileId, disabled }: ExportTransactionsProps) {
  const [exportCsv, { isFetching }] = useLazyExportTransactionsQuery();
  const [statement, statementState] = useDownloadStatementMutation();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [dayErrors, setDayErrors] = useState<{ from?: string; to?: string }>({});
  const [error, setError] = useState("");
  // Each opening starts the records currency afresh: the dialog keeps its content while closed.
  const [opened, setOpened] = useState(0);
  const actions = useRef<HTMLFormElement>(null);
  const days = useRef<HTMLDivElement>(null);

  const save = (url: string, name: string) => {
    Object.assign(document.createElement("a"), { href: url, download: name }).click();
    URL.revokeObjectURL(url);
    actions.current?.closest("dialog")?.close();
  };

  const checkDays = (statementDays: boolean) => {
    const shown = {
      from: statementDays && !from ? COPY.statementDay : undefined,
      to:
        statementDays && !to
          ? COPY.statementDay
          : from && to && to < from
            ? COPY.daysOrder
            : undefined,
    };
    flushSync(() => {
      setDayErrors(shown);
      setError("");
    });
    if (!shown.from && !shown.to) return true;
    days.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    return false;
  };

  const downloadStatement = async () => {
    if (!checkDays(true)) return;
    try {
      save(await statement({ profileId, from, to }).unwrap(), COPY.statementFile(from, to));
    } catch (failure) {
      const { status } = failure as { status?: unknown };
      setError(status === NOT_FOUND ? COPY.statementNeedsBilling : COPY.statementFailed);
    }
  };

  const download = async () => {
    if (!checkDays(false)) return;
    try {
      const csv = await exportCsv({
        profileId,
        from: from || undefined,
        to: to || undefined,
      }).unwrap();
      save(URL.createObjectURL(new Blob([csv], { type: "text/csv" })), COPY.csvFile);
    } catch {
      setError(COPY.exportFailed);
    }
  };

  return (
    <Dialog
      triggerLabel={COPY.export}
      title={COPY.exportTitle}
      trigger={(open) => (
        // Phones keep only its icon, its touch area widened to 44px like an icon button's; the accessible name says
        // what it does.
        <Button
          variant={BUTTON_VARIANTS.secondary}
          aria-label={COPY.export}
          onClick={() => {
            setError("");
            setDayErrors({});
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
      <div ref={days} className="mt-4 grid gap-4 sm:grid-cols-2">
        <TextField
          type="date"
          label={COPY.exportFrom}
          value={from}
          max={to || undefined}
          error={dayErrors.from}
          onChange={(event) => {
            setFrom(event.target.value);
            setDayErrors({});
          }}
        />
        <TextField
          type="date"
          label={COPY.exportTo}
          value={to}
          min={from || undefined}
          error={dayErrors.to}
          onChange={(event) => {
            setTo(event.target.value);
            setDayErrors({});
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
                href={`${APP_ROUTES.billingDetails}?${BILLING_THEN.param}=${BILLING_THEN.transactions}`}
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
          onClick={downloadStatement}
        >
          {COPY.downloadStatement}
        </Button>
        <Button type="button" loading={isFetching} onClick={download}>
          {COPY.exportDownload}
        </Button>
      </form>
    </Dialog>
  );
}
