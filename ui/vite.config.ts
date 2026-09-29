import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  const { TETHER_WEB_VERSION } = loadEnv(mode, ".", "TETHER_WEB_");

  return {
    plugins: [react()],
    define: {
      __TETHER_WEB_VERSION__: JSON.stringify(TETHER_WEB_VERSION || "0.0.0-dev"),
    },
    build: {
      outDir: "../cmd/tether-web/dist",
      emptyOutDir: true,
    },
    test: {
      include: ["src/**/*.test.{ts,tsx}"],
      environment: "jsdom",
      setupFiles: "./src/test-setup.ts",
    },
  };
});
