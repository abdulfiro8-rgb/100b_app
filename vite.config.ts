import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Capacitor loads the built assets from the filesystem, so relative paths are required.
  base: "./",
  build: { outDir: "dist", sourcemap: true },
});
