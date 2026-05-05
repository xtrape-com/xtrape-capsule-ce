import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/@tanstack/react-query/")) return "query-vendor";
          if (id.includes("/@ant-design/icons/")) return "antd-icons";
          if (id.includes("/antd/")) return "antd-core";
          if (id.includes("/@ant-design/") || id.includes("/@rc-component/") || id.includes("/rc-")) return "antd-runtime";
          return "vendor";
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080"
    }
  }
});
