import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: { environment: "node", include: ["packages/**/*.test.ts"] },
  resolve: {
    alias: {
      "@fusionview/core": resolve(rootDir, "packages/core/src"),
      "@fusionview/annotation": resolve(rootDir, "packages/annotation/src"),
      "@fusionview/layout": resolve(rootDir, "packages/layout/src"),
      "@fusionview/renderer-svg": resolve(rootDir, "packages/renderer-svg/src"),
    },
  },
});
