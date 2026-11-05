import { describe, expect, it } from "vitest";
import { clientKind, clientOptions } from "@/features/clients/lib/clients";
import type { Client } from "@/features/clients/types/clients";

const client = (more: Partial<Client>): Client => ({
  clientId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
  name: "Mara Ilić",
  email: "mara@ilic.example",
  address: null,
  country: null,
  taxId: null,
  reference: null,
  reminders: false,
  updatedAt: "2026-10-01T00:00:00Z",
  ...more,
});

describe("client kind", () => {
  it("reads a new client as a business, and a saved one with only a name and email as a person", () => {
    expect(clientKind(undefined)).toBe("business");
    expect(clientKind(client({}))).toBe("person");
    expect(clientKind(client({ taxId: "DE123456789" }))).toBe("business");
    expect(clientKind(client({ country: "DE" }))).toBe("business");
    expect(clientKind(client({ address: "Torstraße 1" }))).toBe("business");
  });
});

describe("clientOptions", () => {
  it("lists the matches with their email under the name", () => {
    const mara = client({});
    expect(clientOptions([mara])).toEqual([
      { value: mara.clientId, label: "Mara Ilić", detail: "mara@ilic.example" },
    ]);
  });
});
