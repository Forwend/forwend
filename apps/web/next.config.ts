import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@forwend/design-tokens", "@forwend/ui-web"],
  images: { formats: ["image/avif", "image/webp"] },
  // Do not write an AGENTS.md into the app; the repository root AGENTS.md is the agent guide.
  agentRules: false,
};

export default nextConfig;
