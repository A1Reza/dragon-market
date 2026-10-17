import { defineConfig } from "vite";
export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.API_TARGET || "http://127.0.0.1:8080",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/lab": {
        target: process.env.LAB_TARGET || "http://127.0.0.1:8082",
        rewrite: (path) => path.replace(/^\/lab/, ""),
      },
    },
  },
});
