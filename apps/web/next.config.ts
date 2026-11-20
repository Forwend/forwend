import path from "node:path";
import type { NextConfig } from "next";
import { API_BASE } from "./src/shared/config/api";
import { contentSecurityPolicy } from "./src/shared/config/security-headers";

// src/proxy.ts sets frame-ancestors on /embed; browsers then ignore X-Frame-Options, per the HTML spec.
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy("'none'") },
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
  agentRules: false, // the repository root AGENTS.md is the agent guide
  devIndicators: false, // its button covers the phone tab bar's taps
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // Same-origin calls need no CORS and keep the token here. API_URL must be set at `next build`.
  async rewrites() {
    const api = process.env.API_URL;
    return api ? [{ source: `${API_BASE}/v1/:path*`, destination: `${api}/v1/:path*` }] : [];
  },
};

export default nextConfig;
