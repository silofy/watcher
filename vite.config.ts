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
  },
});
