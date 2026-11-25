import { defineConfig } from "vite";
export default defineConfig({
  base: process.env.GITHUB_ACTIONS === "true" ? "/cross-exchange-slippage/" : "/",
  server: { host: "0.0.0.0", allowedHosts: true },
  preview: { host: "0.0.0.0", allowedHosts: true }
});
