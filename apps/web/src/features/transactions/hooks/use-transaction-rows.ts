"use client";

import { skipToken } from "@reduxjs/toolkit/query";
import { useEffect, useRef, useState } from "react";
import { useListPendingSendsQuery } from "@/features/send/api/send-api";
import {
  useGetTransactionPagesInfiniteQuery,
  useGetTransactionsQuery,
} from "@/features/transactions/api/transactions-api";
import {
  TRANSACTION_DIRECTIONS,
  TRANSACTION_FILTERS,
} from "@/features/transactions/constants/transactions";
import { sendingRows } from "@/features/transactions/lib/transactions";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { useListFilters, useShownData } from "@/shared/hooks/use-list-filters";

const SENDING_POLL_MS = 3000;

export function useTransactionRows(profileId: string, preview: number | undefined) {
  const filters = useListFilters(
    "direction",
    Object.values(TRANSACTION_FILTERS),
    TRANSACTION_FILTERS.all,
  );
  const [pages, setPages] = useState(1);
  const recent = useGetTransactionsQuery(
    preview ? { profileId, limit: preview } : skipToken,
    LIVE_QUERY,
  );
  const paged = useGetTransactionPagesInfiniteQuery(
    preview ? skipToken : { profileId, direction: filters.apiFilter, q: filters.apiQuery },
    // Polling refetches every loaded page, so only the first page stays live.
    { ...LIVE_QUERY, pollingInterval: pages > 1 ? 0 : LIVE_QUERY.pollingInterval },
  );
  const list = preview ? recent : paged;
  const pagedData = useShownData(filters.key, paged.currentData, paged.data);
  if ((pagedData?.pages.length ?? 1) !== pages) setPages(pagedData?.pages.length ?? 1);
  const data = preview
    ? recent.data
    : pagedData && { items: pagedData.pages.flatMap((page) => page.items) };
  const showsSends =
    Boolean(preview) || (!filters.apiQuery && filters.apiFilter !== TRANSACTION_DIRECTIONS.in);
  const [waiting, setWaiting] = useState(false);
  const pending = useListPendingSendsQuery(showsSends ? profileId : skipToken, {
    ...LIVE_QUERY,
    pollingInterval: waiting ? SENDING_POLL_MS : LIVE_QUERY.pollingInterval,
  });
  const recorded = data?.items ?? [];
  const sending = sendingRows(pending.currentData?.sends ?? [], recorded);
  const sendingCount = useRef(sending.length);
  const { refetch } = list;
  useEffect(() => {
    if (sending.length < sendingCount.current) void refetch();
    sendingCount.current = sending.length;
  }, [sending.length, refetch]);
  if (waiting !== sending.length > 0) setWaiting(sending.length > 0);
  return {
    filters,
    list,
    paged,
    data,
    rows: [...sending, ...recorded].slice(0, preview),
    stale: !preview && !paged.currentData && Boolean(pagedData),
  };
}
