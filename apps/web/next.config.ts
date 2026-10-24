import path from "node:path";
import type { NextConfig } from "next";
import { API_BASE } from "./src/shared/config/api";

// Privy's recommended policy (docs.privy.io/security/implementation-guide/content-security-policy). Scripts allow
// 'unsafe-inline' because Next inlines its own scripts; nonces would make every page dynamic.
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "child-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org",
  "frame-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com",
  "connect-src 'self' https://auth.privy.io wss://relay.walletconnect.com wss://relay.walletconnect.org wss://www.walletlink.org https://*.rpc.privy.systems https://explorer-api.walletconnect.com",
  "worker-src 'self'",
  "manifest-src 'self'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  poweredByHeader: false,
  transpilePackages: ["@forwend/design-tokens", "@forwend/ui-web"],
  images: { formats: ["image/avif", "image/webp"] },
  // Do not write an AGENTS.md into the app; the repository root AGENTS.md is the agent guide.
  agentRules: false,
  // The dev-tools button sits over the phone tab bar and takes its taps; error overlays still appear.
  devIndicators: false,
  // The browser calls the backend same-origin at /api/v1/…, so the api needs no CORS and the token never goes to
  // another origin. Rewrites are fixed at build time: API_URL must be set when `next build` runs.
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  async rewrites() {
    const api = process.env.API_URL;
    return api ? [{ source: `${API_BASE}/v1/:path*`, destination: `${api}/v1/:path*` }] : [];
  },
};

export default nextConfig;
