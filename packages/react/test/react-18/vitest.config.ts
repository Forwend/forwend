import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The package's own tests on React 18: dedupe makes its source and the tests import this folder's React.
export default defineConfig({
  resolve: {
    alias: { "@forwend/js": at("../../../js/src/index.ts") },
    dedupe: ["react", "react-dom"],
  },
  test: {
    environment: "jsdom",
    dir: at(".."),
    include: ["*.test.tsx"],
    env: { REACT_MAJOR: "18" },
  },
});
