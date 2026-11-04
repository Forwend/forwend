// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PERMISSIONS, PROFILE_KINDS, ROLES } from "@/features/profiles/constants/profile";
import { AppSessionContext } from "@/features/profiles/hooks/use-app-session";
import type { AppSession } from "@/features/profiles/types/app-session";
import { ClientScreen } from "@/screens/clients/client-screen";

const CLIENT = {
  clientId: "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
  name: "Mara Ilić",
  email: "mara@example.com",
  address: null,
  country: "DE",
  taxId: null,
  reference: null,
  reminders: true,
  updatedAt: "2026-10-27T10:00:00Z",
};

vi.mock("@/features/clients/api/clients-api", () => ({
  useGetClientQuery: () => ({ currentData: CLIENT }),
}));
vi.mock("@/features/clients/components/client-actions", () => ({ ClientActions: () => null }));
vi.mock("@/screens/clients/client-invoices", () => ({
  ClientInvoices: () => <section aria-label="Invoices" />,
}));

afterEach(cleanup);

it("opens like the other record pages: the client's initials as its tile, Details beside the invoices", () => {
  const profile = {
    profileId: "6f9619ff-8b86-4011-b42d-00c04fc964ff",
    kind: PROFILE_KINDS.freelancer,
    name: "Studio",
    walletAddress: null,
    createdAt: "2026-10-20T10:00:00Z",
    role: ROLES.owner,
    permissions: [PERMISSIONS.clientsRead, PERMISSIONS.invoicesWrite],
  };
  render(
    <AppSessionContext.Provider value={{ profile, profiles: [profile] } as unknown as AppSession}>
      <ClientScreen clientId={CLIENT.clientId} />
    </AppSessionContext.Provider>,
  );
  const header = within(screen.getByRole("banner"));
  expect(header.getByRole("heading", { level: 1, name: "Mara Ilić" })).toBeTruthy();
  expect(header.getByText("MI")).toBeTruthy();
  expect(header.getByRole("link", { name: "New invoice" })).toBeTruthy();
  const invoices = screen.getByRole("region", { name: "Invoices" });
  expect(invoices.nextElementSibling).toBe(screen.getByRole("region", { name: "Details" }));
});
