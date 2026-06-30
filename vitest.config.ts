import { defineConfig } from "vitest/config";

// Tests are pure logic (metrics, scale, schema) — node env, no JSX, no plugins,
// which keeps this config free of the vite plugin type graph.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.{ts,tsx}"],
  },
});
