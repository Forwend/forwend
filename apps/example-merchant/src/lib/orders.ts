import { DatabaseSync } from "node:sqlite";
import type { PricedLine } from "@/lib/catalog";

export interface Order {
  id: string;
  lines: PricedLine[];
  totalCents: number;
  sessionId: string | null;
  payToken: string | null;
  fulfilledAt: string | null;
}

export type Orders = ReturnType<typeof openOrders>;

interface Row {
  id: string;
  lines: string;
  total_cents: number;
  session_id: string | null;
  pay_token: string | null;
  fulfilled_at: string | null;
}

const toOrder = (row: Row | undefined): Order | undefined =>
  row && {
    id: row.id,
    lines: JSON.parse(row.lines),
    totalCents: row.total_cents,
    sessionId: row.session_id,
    payToken: row.pay_token,
    fulfilledAt: row.fulfilled_at,
  };

/** The shop's orders. fulfil is the one place an order turns paid, and it does so once. */
export function openOrders(path: string) {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, lines TEXT NOT NULL, total_cents INTEGER NOT NULL,
    session_id TEXT UNIQUE, pay_token TEXT, fulfilled_at TEXT)`);
  const read = (where: string, value: string) =>
    toOrder(db.prepare(`SELECT * FROM orders WHERE ${where} = ?`).get(value) as Row | undefined);
  return {
    create(id: string, lines: PricedLine[], totalCents: number): void {
      db.prepare("INSERT INTO orders (id, lines, total_cents) VALUES (?, ?, ?)").run(
        id,
        JSON.stringify(lines),
        totalCents,
      );
    },
    attach(id: string, sessionId: string, payToken: string): void {
      db.prepare("UPDATE orders SET session_id = ?, pay_token = ? WHERE id = ?").run(
        sessionId,
        payToken,
        id,
      );
    },
    get: (id: string) => read("id", id),
    bySession: (sessionId: string) => read("session_id", sessionId),
    /** True only the first time: a duplicate or late webhook never ships an order twice. */
    fulfil(id: string): boolean {
      const done = db
        .prepare("UPDATE orders SET fulfilled_at = ? WHERE id = ? AND fulfilled_at IS NULL")
        .run(new Date().toISOString(), id);
      return done.changes === 1;
    },
  };
}

let store: Orders | undefined;

/** Opened on first use, not when Next imports the routes to build. */
export function orders(): Orders {
  store ??= openOrders(process.env.EXAMPLE_DATABASE ?? "example-merchant.db");
  return store;
}
