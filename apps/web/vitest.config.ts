import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: { testTimeout: 15_000, hookTimeout: 15_000 },
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) }
  }
});
