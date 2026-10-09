import type { NextConfig } from "next";
import { API_BASE } from "./src/shared/config/api";

const nextConfig: NextConfig = {
  transpilePackages: ["@forwend/design-tokens", "@forwend/ui-web"],
  images: { formats: ["image/avif", "image/webp"] },
  // Do not write an AGENTS.md into the app; the repository root AGENTS.md is the agent guide.
  agentRules: false,
  // The dev-tools button sits over the phone tab bar and takes its taps (also in the live tests on the dev server).
  // Error overlays still appear.
  devIndicators: false,
  // The browser calls the backend same-origin at /api/v1/…, so the api needs no CORS and the token never goes to
  // another origin. Rewrites are fixed at build time: API_URL must be set when `next build` runs.
  async rewrites() {
    const api = process.env.API_URL;
    return api ? [{ source: `${API_BASE}/v1/:path*`, destination: `${api}/v1/:path*` }] : [];
  },
};

export default nextConfig;
