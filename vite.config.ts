import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/** Serves /api/* from the local api/ folder during `npm run dev`, so no Vercel CLI is needed. */
function apiDev(): Plugin {
  return {
    name: "api-dev",
    configureServer(server) {
      Object.assign(process.env, loadEnv(server.config.mode, process.cwd(), ""));
      server.middlewares.use(async (req, res, next) => {
        const match = req.url?.match(/^\/api\/([a-z-]+)/);
        if (!match) return next();
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const raw = Buffer.concat(chunks).toString();
          const vreq = Object.assign(req, { body: raw ? JSON.parse(raw) : undefined });
          const vres = res as typeof res & { status: (c: number) => typeof vres; json: (o: unknown) => void };
          vres.status = (c) => {
            res.statusCode = c;
            return vres;
          };
          vres.json = (o) => {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(o));
          };
          const mod = await server.ssrLoadModule(`/api/${match[1]}.ts`);
          await mod.default(vreq, vres);
        } catch (e) {
          console.error(e);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: "dev_api_error" }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiDev()],
  test: { environment: "node" },
});
