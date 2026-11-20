"use client";
import { Button, buttonClasses, SearchField, SegmentedControl } from "@forwend/ui-web";
import { ArrowLeftRight, Link2, Store } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { NewInvoiceLink } from "@/features/invoices/components/new-invoice-link";
import { LINKS_COPY } from "@/features/links/constants/links-copy";
import { ExportPayments } from "@/features/payments/components/export-payments";
import { PaymentList } from "@/features/payments/components/payment-list";
import { PaymentReconciliation } from "@/features/payments/components/payment-reconciliation";
import {
  PAYMENT_PARAMS,
  PAYMENT_SOURCES,
  PAYMENT_VIEWS,
  SOURCE_ICONS,
  SOURCE_LABELS,
} from "@/features/payments/constants/payments";
import { PAYMENTS_COPY as COPY } from "@/features/payments/constants/payments-copy";
import type { PaymentFilters } from "@/features/payments/types/payments";
import { PERMISSIONS, PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { can } from "@/features/profiles/lib/profile";
import { useListStoresQuery } from "@/features/stores/api/stores-api";
import { ListFilters } from "@/shared/components/list-filters";
import { ListToolbar } from "@/shared/components/list-toolbar";
import { LoadError } from "@/shared/components/load-error";
import { PageTitle } from "@/shared/components/page-title";
import { APP_ROUTES } from "@/shared/config/routes";
import { API_SETTLEMENT_STATUSES, PAYMENT_STATE_FILTERS } from "@/shared/constants/payment-state";
import { useListFilters } from "@/shared/hooks/use-list-filters";
import { narrowedBy } from "@/shared/lib/payment-state";
import { paymentStateGroup } from "@/shared/lib/payment-state-filter";
import { setParam } from "@/shared/lib/url-params";

const ALL = "all";
const STATES = Object.values(PAYMENT_STATE_FILTERS);

export function PaymentsScreen() {
  const { profile, openRequest } = useAppSession();
  const params = useSearchParams();
  const merchant = profile.kind === PROFILE_KINDS.merchant;
  const stores = useListStoresQuery(profile.profileId, { skip: !merchant });
  const list = useListFilters(PAYMENT_PARAMS.state, STATES, PAYMENT_STATE_FILTERS.all);
  const view =
    Object.values(PAYMENT_VIEWS).find((value) => value === params.get(PAYMENT_PARAMS.view)) ??
    PAYMENT_VIEWS.all;
  const source = PAYMENT_SOURCES.find((value) => value === params.get(PAYMENT_PARAMS.source));
  const storeId = params.get(PAYMENT_PARAMS.storeId) || undefined;
  const linkId = params.get(PAYMENT_PARAMS.linkId) || undefined;
  const moving = params.get(PAYMENT_PARAMS.settlementStatus) === API_SETTLEMENT_STATUSES.pending;
  const filters: PaymentFilters = {
    q: list.apiQuery,
    state: list.apiFilter,
    source,
    storeId,
    linkId,
    settlementStatus: moving ? API_SETTLEMENT_STATUSES.pending : undefined,
  };
  const set = (name: string, value: string) => setParam(name, value === ALL ? "" : value);
  const showAll = () => {
    set(PAYMENT_PARAMS.linkId, "");
    set(PAYMENT_PARAMS.settlementStatus, "");
  };
  const clear = () => {
    list.clear();
    for (const name of [
      PAYMENT_PARAMS.source,
      PAYMENT_PARAMS.storeId,
      PAYMENT_PARAMS.linkId,
      PAYMENT_PARAMS.settlementStatus,
    ])
      set(name, "");
  };
  const unknownSource = Boolean(params.get(PAYMENT_PARAMS.source) && !source);
  const unknownSettlement = Boolean(params.get(PAYMENT_PARAMS.settlementStatus) && !moving);
  const storeList = stores.currentData ?? [];
  const unknownStore = Boolean(
    storeId && stores.currentData && !storeList.some((s) => s.storeId === storeId),
  );
  const showStores = merchant && storeList.length > 1;
  const personal = profile.kind === PROFILE_KINDS.personal;
  const storeName = storeList.find((s) => s.storeId === storeId)?.name;

  const exportButton = (
    <ExportPayments
      profileId={profile.profileId}
      filters={filters}
      disabled={
        unknownSource ||
        unknownSettlement ||
        unknownStore ||
        (merchant && stores.error !== undefined)
      }
    />
  );
  const head = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          className="max-sm:w-full"
          label={COPY.views.label}
          value={view}
          onValueChange={(value) =>
            set(PAYMENT_PARAMS.view, value === PAYMENT_VIEWS.all ? "" : value)
          }
          options={[
            { value: PAYMENT_VIEWS.all, label: COPY.views.all },
            { value: PAYMENT_VIEWS.attention, label: COPY.views.attention },
            { value: PAYMENT_VIEWS.reconciliation, label: COPY.views.reconciliation },
          ]}
        />
        <div className="max-sm:hidden">{exportButton}</div>
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
            <ListFilters
              groups={[
                paymentStateGroup(list.filter, list.setFilter),
                {
                  label: COPY.source,
                  value: source ?? ALL,
                  onValueChange: (value) => set(PAYMENT_PARAMS.source, value),
                  options: [
                    { value: ALL, label: COPY.allSources, icon: ArrowLeftRight },
                    ...PAYMENT_SOURCES.filter((value) => merchant || value !== "checkout").map(
                      (value) => ({
                        value,
                        label: SOURCE_LABELS[value],
                        icon: SOURCE_ICONS[value],
                      }),
                    ),
                  ],
                },
                ...(showStores
                  ? [
                      {
                        label: COPY.store,
                        value: storeId ?? ALL,
                        onValueChange: (value: string) => set(PAYMENT_PARAMS.storeId, value),
                        options: [
                          { value: ALL, label: COPY.allStores, icon: Store },
                          ...storeList.map((store) => ({
                            value: store.storeId,
                            label: store.name,
                          })),
                        ],
                      },
                    ]
                  : []),
              ]}
            />
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
          <Button variant="link" size="sm" onClick={showAll}>
            {COPY.clearLink}
          </Button>
        </p>
      ) : null}
      {moving ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          {COPY.movingFilter}
          <Button variant="link" size="sm" onClick={showAll}>
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
    </>
  );

  return (
    // No payments, nothing to export: the empty state hides the phone's Export too.
    <div className="flex flex-col gap-4 [&:has([data-page-empty])_[data-phone-export]]:hidden">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <PageTitle>{COPY.title}</PageTitle>
          <div data-phone-export className="sm:hidden">
            {exportButton}
          </div>
        </div>
        <p className="text-sm text-muted">{COPY.intro}</p>
      </div>
      {unknownSource || unknownSettlement || unknownStore ? (
        <>
          {head}
          <p role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
            {unknownStore ? COPY.storeGone : COPY.unknownFilter}
            <Button variant="link" size="sm" onClick={clear}>
              {COPY.clearFilters}
            </Button>
          </p>
        </>
      ) : view === PAYMENT_VIEWS.reconciliation ? (
        <>
          {head}
          <PaymentReconciliation
            key={profile.profileId}
            profileId={profile.profileId}
            filters={filters}
          />
        </>
      ) : (
        <PaymentList
          profileId={profile.profileId}
          filters={filters}
          attention={view === PAYMENT_VIEWS.attention}
          showStore={showStores}
          filtered={list.filtered || Boolean(source || storeId || linkId || moving)}
          onClear={clear}
          narrowed={narrowedBy(
            list.apiQuery,
            list.filter,
            source ? COPY.sourceIs(SOURCE_LABELS[source]) : null,
            storeName ? COPY.storeIs(storeName) : null,
          )}
          head={head}
          emptyAction={
            can(profile, PERMISSIONS.invoicesWrite) ? (
              <div className="flex flex-wrap justify-center gap-2">
                <NewInvoiceLink
                  variant="secondary"
                  onRequest={personal ? openRequest : undefined}
                />
                {personal ? null : (
                  <Link
                    href={APP_ROUTES.newLink}
                    className={buttonClasses({ variant: "secondary" })}
                  >
                    <Link2 aria-hidden className="size-[var(--fw-icon-sm)]" />
                    {LINKS_COPY.newTitle}
                  </Link>
                )}
              </div>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
