import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { handleWorldCupApi } from "./server/worldCupProvider";

export default defineConfig({
  plugins: [
    {
      name: "world-cup-api-proxy",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const handled = await handleWorldCupApi(req, res);
          if (!handled) {
            next();
          }
        });
      },
    },
    react(),
  ],
});
