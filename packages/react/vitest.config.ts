import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@forwend/js": fileURLToPath(new URL("../js/src/index.ts", import.meta.url)) },
  },
  test: { environment: "jsdom" },
});
