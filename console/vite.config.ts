import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The console is served same-origin against TrueForge: /api is proxied to the
// harness so the UI SDK's default baseUrl ("/") works without CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5178,
    proxy: {
      "/api": {
        target: process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8891",
        changeOrigin: true,
      },
    },
  },
});
