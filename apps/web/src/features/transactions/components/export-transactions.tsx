"use client";

import { BUTTON_VARIANTS, Button, Dialog, TextField } from "@forwend/ui-web";
import { Download } from "lucide-react";
import { useRef, useState } from "react";
import { useLazyExportTransactionsQuery } from "@/features/transactions/api/transactions-api";
import { RecordsCurrency } from "@/features/transactions/components/records-currency";
import { TRANSACTIONS_COPY as COPY } from "@/features/transactions/constants/transactions-copy";

export interface ExportTransactionsProps {
  profileId: string;
  disabled: boolean;
}

// R-109: every transaction in the UTC days chosen, as the API's CSV (R-108); an empty day sets no limit. The days are
// the browser's date fields: the kit's calendar opens inside its field, and the dialog's scrolling body cuts it off.
export function ExportTransactions({ profileId, disabled }: ExportTransactionsProps) {
  const [exportCsv, { isFetching }] = useLazyExportTransactionsQuery();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");
  // Each opening starts the records currency afresh: the dialog keeps its content while closed.
  const [opened, setOpened] = useState(0);
  const actions = useRef<HTMLFormElement>(null);

  const download = async () => {
    setError("");
    try {
      const csv = await exportCsv({
        profileId,
        from: from || undefined,
        to: to || undefined,
      }).unwrap();
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      Object.assign(document.createElement("a"), { href: url, download: COPY.csvFile }).click();
      URL.revokeObjectURL(url);
      actions.current?.closest("dialog")?.close();
    } catch {
      setError(COPY.exportFailed);
    }
  };

  return (
    <Dialog
      triggerLabel={COPY.exportCsv}
      title={COPY.exportTitle}
      trigger={(open) => (
        // Phones keep only its icon, its touch area widened to 44px like an icon button's; the accessible name says
        // what it does.
        <Button
          variant={BUTTON_VARIANTS.secondary}
          aria-label={COPY.exportCsv}
          onClick={() => {
            setError("");
            setOpened((n) => n + 1);
            open();
          }}
          disabled={disabled}
          className="max-sm:w-10 max-sm:px-0 max-sm:pointer-coarse:before:left-1/2 max-sm:pointer-coarse:before:w-11 max-sm:pointer-coarse:before:-translate-x-1/2"
        >
          <Download aria-hidden className="size-[var(--fw-icon-sm)]" />
          <span className="max-sm:sr-only">{COPY.exportCsv}</span>
        </Button>
      )}
    >
      <p>{COPY.exportText}</p>
      <div className="mt-4">
        <RecordsCurrency key={opened} profileId={profileId} />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <TextField
          type="date"
          label={COPY.exportFrom}
          value={from}
          max={to || undefined}
          onChange={(event) => setFrom(event.target.value)}
        />
        <TextField
          type="date"
          label={COPY.exportTo}
          value={to}
          min={from || undefined}
          onChange={(event) => setTo(event.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <form ref={actions} method="dialog" className="mt-5 flex flex-wrap justify-end gap-2">
        <Button type="submit" variant={BUTTON_VARIANTS.secondary}>
          {COPY.exportCancel}
        </Button>
        <Button type="button" loading={isFetching} onClick={download}>
          {COPY.exportDownload}
        </Button>
      </form>
    </Dialog>
  );
}
