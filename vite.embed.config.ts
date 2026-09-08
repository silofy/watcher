import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

// Builds embed/index.tsx into a single self-contained IIFE (JS with CSS inlined as a string),
// hostable anywhere. Separate from the app/Tauri build.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  // React and some deps read process.env.NODE_ENV; this is an IIFE for the browser, so replace it
  // at build time and shim `process` at the top of the bundle for any remaining bare references.
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    target: "es2022",
    outDir: "dist-embed",
    cssCodeSplit: false,
    lib: { entry: resolve(__dirname, "embed/index.tsx"), name: "WatcherEmbed", fileName: () => "watcher-embed.js", formats: ["iife"] },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: "watcher-embed.[ext]",
        banner: "window.process=window.process||{env:{NODE_ENV:'production'}};window.global=window.global||window;",
      },
    },
  },
});
