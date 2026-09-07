import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // bcrypt- en Fastify-tests draaien parallel in kleine Docker/WSL-omgevingen.
    // Geef afzonderlijke tests ruimte zonder de productietimeouts te beïnvloeden.
    testTimeout: 15_000,
    hookTimeout: 15_000
  }
});
