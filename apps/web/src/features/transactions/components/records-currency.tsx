"use client";

import { SelectField } from "@forwend/ui-web";
import { useState } from "react";
import { AGREED_CURRENCIES } from "@/features/invoices/constants/invoices";
import { currencyOptions } from "@/features/invoices/lib/invoices";
import {
  recordsCurrencySaveKey,
  useGetRecordsCurrencyQuery,
  useSetRecordsCurrencyMutation,
} from "@/features/transactions/api/transactions-api";
import { RECORDS_BASE_CURRENCY, USD_ONLY } from "@/features/transactions/constants/transactions";
import { TRANSACTIONS_COPY as COPY } from "@/features/transactions/constants/transactions-copy";

const OPTIONS = [
  { value: USD_ONLY, label: COPY.usdOnly },
  ...currencyOptions(
    Object.keys(AGREED_CURRENCIES).filter((code) => code !== RECORDS_BASE_CURRENCY),
  ),
];

export interface RecordsCurrencyProps {
  profileId: string;
}

// R-111: the choice shows at once, until the read confirms it.
export function RecordsCurrency({ profileId }: RecordsCurrencyProps) {
  const saved = useGetRecordsCurrencyQuery(profileId, { refetchOnMountOrArgChange: true });
  const [save, saving] = useSetRecordsCurrencyMutation({
    fixedCacheKey: recordsCurrencySaveKey(profileId),
  });
  const [chosen, setChosen] = useState<string | null>(null);
  const current = saved.currentData?.currency ?? USD_ONLY;
  if (chosen !== null && chosen === current) setChosen(null);
  return (
    <SelectField
      label={COPY.recordsCurrency}
      hint={COPY.recordsCurrencyHint}
      error={
        saved.isError
          ? COPY.recordsCurrencyLoadFailed
          : saving.isError
            ? COPY.recordsCurrencyFailed
            : undefined
      }
      options={OPTIONS}
      value={chosen ?? current}
      disabled={!saved.currentData || saved.isError || saved.isFetching || saving.isLoading}
      onValueChange={async (value) => {
        setChosen(value);
        try {
          await save({ profileId, currency: value === USD_ONLY ? null : value }).unwrap();
        } catch {
          setChosen(null);
        }
      }}
    />
  );
}
