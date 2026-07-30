import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "fs";
import path from "path";

type App = Hono<{ Bindings: HttpBindings }>;

/**
 * Cache policy for static responses:
 * - /assets/* (Vite content-hashed bundles) → immutable, 1 year
 * - everything else (index.html, SPA routes, icons) → no-cache, so browsers
 *   always revalidate and immediately pick up newly deployed builds
 * - /api/* → untouched
 */
export function cacheControlFor(reqPath: string): string | null {
  if (reqPath.startsWith("/api/")) return null;
  if (reqPath.startsWith("/assets/")) {
    return "public, max-age=31536000, immutable";
  }
  return "no-cache";
}

export function serveStaticFiles(app: App) {
  const distPath = path.resolve(import.meta.dirname, "../dist/public");

  app.use("*", async (c, next) => {
    await next();
    const cc = cacheControlFor(c.req.path);
    if (cc) c.res.headers.set("Cache-Control", cc);
  });

  app.use("*", serveStatic({ root: "./dist/public" }));

  app.notFound((c) => {
    const accept = c.req.header("accept") ?? "";
    if (!accept.includes("text/html")) {
      return c.json({ error: "Not Found" }, 404);
    }
    const indexPath = path.resolve(distPath, "index.html");
    const content = fs.readFileSync(indexPath, "utf-8");
    return c.html(content);
  });
}
