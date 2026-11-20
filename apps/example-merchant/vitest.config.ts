import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The source, as packages/react reads @forwend/js: unit tests never wait on, or race, a build of dist.
      forwend: fileURLToPath(new URL("../../packages/node/src/index.ts", import.meta.url)),
    },
  },
  test: { include: ["test/**/*.test.ts"] },
});
