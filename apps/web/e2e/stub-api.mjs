// The api the browser tests' servers ask in place of the backend; playwright.config.ts starts it once.
// - The embed check (R-168): only the two local test origins below may frame a checkout.
// - The pay page's view and pick, answered as the api does.
// - /shop: a merchant page that frames ?src and keeps what the frame posts to it.
// - Checkout sessions for the example merchant (R-170), each paying through the pay page fixture's token.
// - /__test/sessions: what the merchant sent, and a switch that makes a session paid.
// - /__test/unmatched: every request no route answered, so a test that leaves an api call unmocked fails the run.
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.E2E_API_PORT);
const allowed = [`http://localhost:${port}`, `http://localhost:${process.env.E2E_EXAMPLE_PORT}`];
const sessions = new Map(); // sessionId -> { body, paid }
const keys = new Map(); // Idempotency-Key -> sessionId
const unmatched = [];

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
};

const read = (req) =>
  new Promise((resolve) => {
    let text = "";
    req.on("data", (chunk) => {
      text += chunk;
    });
    req.on("end", () => resolve(text ? JSON.parse(text) : {}));
  });

const session = (id) => {
  const { body, paid } = sessions.get(id);
  return {
    sessionId: id,
    status: paid ? "complete" : "open",
    payment: {
      paymentId: id,
      purpose: "checkout",
      storeId: body.storeId,
      reference: body.reference ?? null,
      paymentStatus: paid ? "paid" : "open",
      settlementStatus: paid ? "pending" : "none",
      hostedUrl: `${process.env.FORWEND_URL}/pay/${process.env.PAY_TOKEN}`,
    },
  };
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  const path = url.pathname;
  const markPaid = path.match(/^\/__test\/sessions\/(0x[0-9a-f]{64})\/paid$/)?.[1];
  const sessionId = path.match(/^\/v1\/profiles\/[^/]+\/checkout-sessions\/(0x[0-9a-f]{64})$/)?.[1];
  if (path === "/health") return json(res, 200, {});
  if (path === "/shop") {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(`<!doctype html><html lang="en"><title>Shop</title><script>
      window.heard = [];
      addEventListener("message", (e) => {
        if (e.source === document.querySelector("iframe").contentWindow) heard.push({ origin: e.origin, data: e.data });
      });
    </script><iframe title="Checkout" src="${url.searchParams.get("src")}" style="width:400px;height:640px;border:0"></iframe></html>`);
  }
  // The pay page's view and pick: a test that checks them routes them in the browser.
  if (/^\/v1\/invoices\/[0-9a-f]{64}\/(views|pick)$/.test(path)) return json(res, 204);
  if (/^\/v1\/invoices\/[0-9a-f]{64}\/embed$/.test(path)) {
    return json(res, 200, { allowed: allowed.includes(url.searchParams.get("origin")) });
  }
  if (path === "/__test/unmatched") return json(res, 200, unmatched);
  if (path === "/__test/sessions") {
    return json(
      res,
      200,
      [...sessions].map(([sessionId, s]) => ({ sessionId, ...s })),
    );
  }
  if (req.method === "POST" && markPaid) {
    if (!sessions.has(markPaid)) return json(res, 404, {});
    sessions.get(markPaid).paid = true;
    return json(res, 204);
  }
  if (/^\/v1\/profiles\/[^/]+\//.test(path) && req.headers.authorization !== "Bearer fw_test_e2e") {
    return json(res, 401, { error: { code: "unauthorized", message: "no key" } });
  }
  if (req.method === "POST" && /^\/v1\/profiles\/[^/]+\/checkout-sessions$/.test(path)) {
    const key = req.headers["idempotency-key"];
    if (keys.has(key)) return json(res, 200, session(keys.get(key)));
    const id = `0x${randomBytes(32).toString("hex")}`;
    sessions.set(id, { body: await read(req), paid: false });
    keys.set(key, id);
    return json(res, 201, session(id));
  }
  if (sessionId && sessions.has(sessionId)) return json(res, 200, session(sessionId));
  unmatched.push(`${req.method} ${path}`);
  json(res, 404, { error: { code: "not_found", message: "not in the stub" } });
}).listen(port, "127.0.0.1");
