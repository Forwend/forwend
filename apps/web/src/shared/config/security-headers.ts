/** The RPC the browser reaches itself, for a send whose wallet pays its own gas (R-216): Privy reads the nonce and
 * broadcasts through it. Kept here, not with the chains, as next.config loads this file on its own. */
export const WALLET_PAID_RPCS: Readonly<Record<number, string>> = {
  5042002: "https://arc-testnet-rpc.publicnode.com",
};

// Privy's recommended policy (docs.privy.io/security/implementation-guide/content-security-policy). Scripts allow
// 'unsafe-inline' because Next inlines its own scripts; nonces would make every page dynamic.
/** Every page's policy. frameAncestors is 'none' on all but /embed, where src/proxy.ts names one origin (R-168). */
export function contentSecurityPolicy(frameAncestors: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
    "child-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org",
    "frame-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com",
    `connect-src 'self' https://auth.privy.io wss://relay.walletconnect.com wss://relay.walletconnect.org wss://www.walletlink.org https://*.rpc.privy.systems https://explorer-api.walletconnect.com ${Object.values(WALLET_PAID_RPCS).join(" ")}`,
    "worker-src 'self'",
    "manifest-src 'self'",
  ].join("; ");
}
