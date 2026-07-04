import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Tauri expects a fixed port and to fail (not silently pick another) if taken.
  server: { port: 5173, strictPort: true },
  // Relative base so the production bundle also opens from file:// (portable HTML export, brief §6.3).
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist",
    rollupOptions: {
      output: {
        // Force a single JS chunk. Rollup otherwise splits a shared chunk (the code behind
        // src/lib/llm/*, src/lib/pwnbox.ts, etc.'s dynamic import()s) into its own file — fine for
        // the normal dev-server/Tauri build (both serve dist/assets/* as real files), but it breaks
        // scripts/export-html.tsx's portable file:// export: that script inlines exactly one JS
        // asset (`readAsset(".js")`) directly into a <script type="module"> tag, so a runtime
        // dynamic import() of a second chunk resolves against the *document's* URL (there's no
        // src="…" to resolve relative to) and always 404s — silently breaking every client
        // interaction (tabs, the write-up form, live sync) in the exported report.
        inlineDynamicImports: true,
      },
    },
  },
});
