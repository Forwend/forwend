"use client";
import { Button, SearchField, SegmentedControl, SelectMenu } from "@forwend/ui-web";
import { ArrowLeftRight, Store } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ExportPayments } from "@/features/payments/components/export-payments";
import { PaymentList } from "@/features/payments/components/payment-list";
import { PaymentReconciliation } from "@/features/payments/components/payment-reconciliation";
import {
  PAYMENT_SOURCES,
  PAYMENT_VIEWS,
  SOURCE_ICONS,
  SOURCE_LABELS,
} from "@/features/payments/constants/payments";
import { PAYMENTS_COPY as COPY } from "@/features/payments/constants/payments-copy";
import type { PaymentFilters } from "@/features/payments/types/payments";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { useListStoresQuery } from "@/features/stores/api/stores-api";
import { ListToolbar } from "@/shared/components/list-toolbar";
import { LoadError } from "@/shared/components/load-error";
import { PaymentStateFilter } from "@/shared/components/payment-state-filter";
import { APP_ROUTES } from "@/shared/config/routes";
import { PAYMENT_STATE_FILTERS } from "@/shared/constants/payment-state";
import { useListFilters, withParam } from "@/shared/hooks/use-list-filters";

const ALL = "all";
const STATES = Object.values(PAYMENT_STATE_FILTERS);

export function PaymentsScreen() {
  const { profile } = useAppSession();
  const params = useSearchParams();
  const pathname = usePathname();
  const merchant = profile.kind === PROFILE_KINDS.merchant;
  const stores = useListStoresQuery(profile.profileId, { skip: !merchant });
  const list = useListFilters("state", STATES, PAYMENT_STATE_FILTERS.all);
  const view =
    Object.values(PAYMENT_VIEWS).find((value) => value === params.get("view")) ?? PAYMENT_VIEWS.all;
  const source = PAYMENT_SOURCES.find((value) => value === params.get("source"));
  const storeId = params.get("storeId") || undefined;
  const linkId = params.get("linkId") || undefined;
  const filters: PaymentFilters = {
    q: list.apiQuery,
    state: list.apiFilter,
    source,
    storeId,
    linkId,
  };
  const set = (name: string, value: string) => {
    const { search, hash } = window.location;
    window.history.replaceState(
      null,
      "",
      `${pathname}${withParam(search, name, value === ALL ? "" : value)}${hash}`,
    );
  };
  const clear = () => {
    list.clear();
    for (const name of ["source", "storeId", "linkId"]) set(name, "");
  };
  const unknownSource = Boolean(params.get("source") && !source);
  const storeList = stores.currentData ?? [];
  const unknownStore = Boolean(
    storeId && stores.currentData && !storeList.some((s) => s.storeId === storeId),
  );
  const showStores = merchant && storeList.length > 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">{COPY.title}</h1>
        {/* Payments, Activity and Transactions overlap; one line says which this is. */}
        <p className="text-sm text-muted">{COPY.intro}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label={COPY.views.label}
          value={view}
          onValueChange={(value) => set("view", value === PAYMENT_VIEWS.all ? "" : value)}
          options={[
            { value: PAYMENT_VIEWS.all, label: COPY.views.all },
            { value: PAYMENT_VIEWS.attention, label: COPY.views.attention },
            { value: PAYMENT_VIEWS.reconciliation, label: COPY.views.reconciliation },
          ]}
        />
        <ExportPayments
          profileId={profile.profileId}
          filters={filters}
          disabled={unknownSource || unknownStore || (merchant && stores.isError)}
        />
      </div>
      {view === PAYMENT_VIEWS.reconciliation ? null : (
        <ListToolbar
          search={
            <SearchField
              label={COPY.search}
              placeholder={COPY.searchPlaceholder}
              value={list.search}
              onValueChange={list.setSearch}
              className="flex-1"
            />
          }
          filter={
            <>
              <PaymentStateFilter value={list.filter} onValueChange={list.setFilter} />
              <SelectMenu
                label={COPY.source}
                value={source ?? ALL}
                onValueChange={(value) => set("source", value)}
                options={[
                  { value: ALL, label: COPY.allSources, icon: ArrowLeftRight },
                  ...PAYMENT_SOURCES.filter((value) => merchant || value !== "checkout").map(
                    (value) => ({ value, label: SOURCE_LABELS[value], icon: SOURCE_ICONS[value] }),
                  ),
                ]}
              />
              {showStores ? (
                <SelectMenu
                  label={COPY.store}
                  value={storeId ?? ALL}
                  onValueChange={(value) => set("storeId", value)}
                  options={[
                    { value: ALL, label: COPY.allStores, icon: Store },
                    ...storeList.map((store) => ({ value: store.storeId, label: store.name })),
                  ]}
                />
              ) : null}
            </>
          }
        />
      )}
      {linkId ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          {COPY.linkFilter}
          <Link
            href={`${APP_ROUTES.links}/${linkId}`}
            className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
          >
            {COPY.viewLink}
          </Link>
          <Button variant="link" size="sm" onClick={() => set("linkId", "")}>
            {COPY.clearLink}
          </Button>
        </p>
      ) : null}
      {merchant && stores.error ? (
        <LoadError
          inline
          message={COPY.storesFailed}
          onRetry={() => void stores.refetch()}
          retrying={stores.isFetching}
        />
      ) : null}
      {unknownSource || unknownStore ? (
        <p role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
          {unknownStore ? COPY.storeGone : COPY.unknownFilter}
          <Button variant="link" size="sm" onClick={clear}>
            {COPY.clearFilters}
          </Button>
        </p>
      ) : view === PAYMENT_VIEWS.reconciliation ? (
        <PaymentReconciliation
          key={profile.profileId}
          profileId={profile.profileId}
          filters={filters}
        />
      ) : (
        <PaymentList
          profileId={profile.profileId}
          filters={filters}
          attention={view === PAYMENT_VIEWS.attention}
          showStore={showStores}
          filtered={list.filtered || Boolean(source || storeId || linkId)}
          onClear={clear}
        />
      )}
    </div>
  );
}
