// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PERMISSIONS, PROFILE_KINDS, ROLES } from "@/features/profiles/constants/profile";
import { AppSessionContext } from "@/features/profiles/hooks/use-app-session";
import type { AppSession } from "@/features/profiles/types/app-session";
import { StoreScreen } from "@/screens/stores/store-screen";

const STORE = {
  storeId: "2c1d43a6-58a1-4bd4-9b6f-1f2a3b4c5d6e",
  name: "Main shop",
  defaultExpiresIn: 3600,
  allowedOrigins: [],
  brandColor: null,
  logoAt: null,
  tokensOff: [],
  updatedAt: "2026-10-27T10:00:00Z",
};

vi.mock("@/features/stores/api/stores-api", () => ({
  useGetStoreQuery: () => ({ currentData: STORE }),
}));
vi.mock("@/features/profiles/api/profiles-api", () => ({
  useGetProfileTokensQuery: () => ({ currentData: [] }),
}));
vi.mock("@/features/payments/components/payment-list", () => ({ PaymentList: () => <ul /> }));
vi.mock("@/features/payments/components/export-payments", () => ({
  ExportPayments: () => <button type="button">Export</button>,
}));

afterEach(cleanup);

it("keeps the header to the store and its Edit, and the payments' own actions at the list's head", () => {
  const profile = {
    profileId: "6f9619ff-8b86-4011-b42d-00c04fc964ff",
    kind: PROFILE_KINDS.merchant,
    name: "Shop",
    walletAddress: null,
    createdAt: "2026-10-20T10:00:00Z",
    role: ROLES.owner,
    permissions: [PERMISSIONS.storesRead, PERMISSIONS.storesWrite],
  };
  render(
    <AppSessionContext.Provider value={{ profile, profiles: [profile] } as unknown as AppSession}>
      <StoreScreen storeId={STORE.storeId} />
    </AppSessionContext.Provider>,
  );
  const header = within(screen.getByRole("banner"));
  expect(header.getByRole("heading", { level: 1, name: "Main shop" })).toBeTruthy();
  expect(header.getByRole("link", { name: "Edit" })).toBeTruthy();
  expect(header.queryByRole("link", { name: "Open in Payments" })).toBeNull();
  const payments = within(screen.getByRole("region", { name: "Payments" }));
  expect(payments.getByRole("link", { name: "Open in Payments" }).getAttribute("href")).toBe(
    `/app/payments?storeId=${STORE.storeId}`,
  );
  expect(payments.getByRole("button", { name: "Export" })).toBeTruthy();
});
