import type { NextConfig } from "next";

// A strict policy: scripts and requests only from this shop, frames only from Forwend's checkout. FORWEND_URL is read
// when the shop is built; without it no frame loads.
const forwend = process.env.FORWEND_URL ? new URL(process.env.FORWEND_URL).origin : "'none'";
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  `frame-src ${forwend}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: CSP }] }];
  },
};

export default nextConfig;
