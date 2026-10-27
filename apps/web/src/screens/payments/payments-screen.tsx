"use client";
import { Button, SegmentedControl, SelectField } from "@forwend/ui-web";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { STATUS_FILTERS } from "@/features/activity/constants/activity";
import { ExportPayments } from "@/features/payments/components/export-payments";
import { PaymentList } from "@/features/payments/components/payment-list";
import { PaymentReconciliation } from "@/features/payments/components/payment-reconciliation";
import {
  PAYMENT_SOURCES,
  PAYMENT_VIEWS,
  SOURCE_LABELS,
} from "@/features/payments/constants/payments";
import type { Payment, PaymentFilters } from "@/features/payments/types/payments";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { useListStoresQuery } from "@/features/stores/api/stores-api";
import { APP_ROUTES } from "@/shared/config/routes";
export function PaymentsScreen() {
  const { profile } = useAppSession();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const merchant = profile.kind === PROFILE_KINDS.merchant;
  const stores = useListStoresQuery(profile.profileId, { skip: !merchant });
  const view =
    Object.values(PAYMENT_VIEWS).find((value) => value === params.get("view")) ?? PAYMENT_VIEWS.all;
  const source = PAYMENT_SOURCES.find((value) => value === params.get("source"));
  const status = Object.values(STATUS_FILTERS).find(
    (value) => value === params.get("status") && value !== STATUS_FILTERS.all,
  );
  const filters: PaymentFilters = {
    storeId: params.get("storeId") || undefined,
    linkId: params.get("linkId") || undefined,
    source,
    status,
  };
  const set = (name: string, value: string) => {
    const next = new URLSearchParams(window.location.search);
    if (value && value !== "all") next.set(name, value);
    else next.delete(name);
    window.history.replaceState(
      null,
      "",
      `${pathname}${next.size ? `?${next}` : ""}${window.location.hash}`,
    );
  };
  const invalidFilter = Boolean(
    (params.get("source") && params.get("source") !== "all" && !source) ||
      (params.get("status") && params.get("status") !== "all" && !status),
  );
  const invalidStore = Boolean(
    filters.storeId &&
      stores.currentData &&
      !stores.currentData.some((store) => store.storeId === filters.storeId),
  );
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">Payments</h1>
        <p className="text-muted">
          Track money requested, received, held and settled across your selling channels.
        </p>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="Payment views"
          value={view}
          onValueChange={(value) => set("view", value)}
          options={[
            { value: PAYMENT_VIEWS.all, label: "All payments" },
            { value: PAYMENT_VIEWS.attention, label: "Needs attention" },
            { value: PAYMENT_VIEWS.reconciliation, label: "Reconciliation" },
          ]}
        />
        <ExportPayments
          profileId={profile.profileId}
          filters={filters}
          disabled={
            invalidFilter || invalidStore || (merchant && (stores.isError || !stores.currentData))
          }
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {merchant ? (
          <SelectField
            label="Store"
            value={filters.storeId ?? "all"}
            disabled={!stores.currentData}
            options={[
              { value: "all", label: "All permitted stores" },
              ...(stores.currentData ?? []).map((store) => ({
                value: store.storeId,
                label: store.name,
              })),
            ]}
            onValueChange={(value) => set("storeId", value)}
          />
        ) : null}
        <SelectField
          label="Source"
          value={source ?? "all"}
          options={[
            { value: "all", label: "All sources" },
            ...PAYMENT_SOURCES.map((value) => ({ value, label: SOURCE_LABELS[value] })),
          ]}
          onValueChange={(value) => set("source", value as Payment["source"])}
        />
        <SelectField
          label="Payment status"
          value={status ?? "all"}
          options={Object.values(STATUS_FILTERS).map((value) => ({
            value,
            label:
              value === STATUS_FILTERS.all
                ? "All statuses"
                : value.slice(0, 1).toUpperCase() + value.slice(1),
          }))}
          onValueChange={(value) => set("status", value)}
        />
      </div>
      {filters.linkId ? (
        <p className="text-sm text-muted">
          Showing purchases from one payment link.{" "}
          <Link
            href={`${APP_ROUTES.links}/${filters.linkId}`}
            className="text-info underline underline-offset-4"
          >
            View offer
          </Link>{" "}
          ·{" "}
          <Button variant="link" size="sm" onClick={() => set("linkId", "")}>
            Clear link filter
          </Button>
        </p>
      ) : null}
      {invalidFilter ? (
        <p role="alert" className="text-sm text-danger">
          Unknown payment filter.{" "}
          <Button variant="link" onClick={() => router.replace(APP_ROUTES.payments)}>
            Clear filters
          </Button>
        </p>
      ) : merchant && stores.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
          We could not load stores. Check the store filter before continuing.
          <Button variant="secondary" size="sm" onClick={() => void stores.refetch()}>
            Try again
          </Button>
        </div>
      ) : merchant && !stores.currentData ? (
        <p role="status" className="text-sm text-muted">
          Loading stores…
        </p>
      ) : invalidStore ? (
        <div role="alert" className="text-sm text-danger">
          This store is unavailable.{" "}
          <Button variant="link" onClick={() => set("storeId", "")}>
            Clear store filter
          </Button>
        </div>
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
        />
      )}
    </div>
  );
}
