// Prints a working RPC URL for a chain from chains.json: every Infura key in turn, then public RPCs.
// A URL counts only if eth_chainId matches, so a key without access to the network is skipped.
// Usage: node script/rpc.mjs <chain>   (INFURA_API_KEYS=key1,key2 from the environment or packages/contracts/.env)
import { existsSync, readFileSync } from "node:fs";

const envFile = new URL("../.env", import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

const name = process.argv[2];
const chains = JSON.parse(readFileSync(new URL("../chains.json", import.meta.url), "utf8"));
const chain = chains[name];
if (!chain) {
  console.error(`unknown chain "${name}"; known: ${Object.keys(chains).join(", ")}`);
  process.exit(1);
}

const keys = (process.env.INFURA_API_KEYS ?? "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);
const infura = chain.infura ? keys.map((k) => `https://${chain.infura}.infura.io/v3/${k}`) : [];

for (const url of [...infura, ...chain.public]) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json();
    if (Number(body.result) === chain.chainId) {
      console.log(url);
      process.exit(0);
    }
  } catch {
    // try the next URL
  }
}
console.error(`no working RPC for ${name}`);
process.exit(1);
