import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Capacitor serves the built assets from the filesystem, so paths must be relative.
  base: "./",
  build: { outDir: "dist", sourcemap: true },
});
