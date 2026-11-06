// The live suite's stand-in for Resend: the api sends Confirm it's you codes here (R-137), and the tests read them.
// It keeps each recipient's newest subject, which carries the code, until a test reads it: a later read waits for a new one.
import { createServer } from "node:http";

const port = Number(process.env.FAKE_RESEND_PORT ?? 4319);
const last = new Map();

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "POST" && url.pathname === "/emails") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const message = JSON.parse(body);
      for (const to of message.to ?? []) last.set(to.toLowerCase(), message.subject);
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ id: "fake" }));
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/code") {
    const to = (url.searchParams.get("to") ?? "").toLowerCase();
    const subject = last.get(to) ?? "";
    last.delete(to);
    const code = /(\d{6})$/.exec(subject)?.[1] ?? "";
    res
      .writeHead(code ? 200 : 404, { "content-type": "application/json" })
      .end(JSON.stringify({ code }));
    return;
  }
  res.writeHead(url.pathname === "/health" ? 200 : 404).end();
}).listen(port, "127.0.0.1");
