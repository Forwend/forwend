import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@forwend/design-tokens", "@forwend/ui-web"],
  images: { formats: ["image/avif", "image/webp"] },
};

export default nextConfig;
