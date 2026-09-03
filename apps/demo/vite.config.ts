import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: appDir,
  plugins: [react()],
  resolve: {
    alias: {
      "@fusionview/core": resolve(appDir, "../../packages/core/src"),
      "@fusionview/annotation": resolve(appDir, "../../packages/annotation/src"),
      "@fusionview/layout": resolve(appDir, "../../packages/layout/src"),
      "@fusionview/renderer-svg": resolve(appDir, "../../packages/renderer-svg/src"),
      "@fusionview/react": resolve(appDir, "../../packages/react/src"),
    },
  },
  server: { port: 5173, host: "127.0.0.1" },
});
