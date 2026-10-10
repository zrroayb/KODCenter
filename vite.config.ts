import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import process from "node:process";
import { yahooFinanceProxy } from "./server/app";

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), "") };

  return {
    plugins: [yahooFinanceProxy(env), react()],
    // Baked at build time so the running site can show exactly which build is live — the
    // top-right stamp updates only when a new bundle is deployed.
    define: {
      __BUILD_TIME__: JSON.stringify(new Date().toISOString())
    },
    build: {
      rollupOptions: {
        output: {
          // Tek 730 KB'lik chunk yerine: React runtime'ı ve ikon kütüphanesini ayır ki
          // uygulama kodu değişince tarayıcı onları yeniden indirmesin (uzun ömürlü cache).
          // Fonksiyon formu şart: react-dom/client ve /server alt yollarını da yakalamak için
          // modül id'sinde eşleştiriyoruz (obje formu tam paket adı istiyordu, alt yolları kaçırdı).
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (id.includes("react-dom") || id.includes("/react/") || id.includes("scheduler")) return "react-vendor";
            if (id.includes("lucide-react")) return "icons";
            return undefined;
          }
        }
      }
    },
    server: {
      port: 8787,
      strictPort: false
    },
    preview: {
      allowedHosts: ["kodcenter.onrender.com"]
    },
    test: {
      environment: "node"
    }
  };
});
