/**
 * Cache-policy unit tests — pure function, no DB.
 * Guarantees the app shell is always revalidated (so new deploys reach
 * users immediately) while hashed bundles are cached forever.
 */
import { describe, expect, it } from "vitest";
import { cacheControlFor } from "./lib/vite";

describe("static cache policy", () => {
  it("never caches the app shell or SPA routes", () => {
    expect(cacheControlFor("/")).toBe("no-cache");
    expect(cacheControlFor("/index.html")).toBe("no-cache");
    expect(cacheControlFor("/settings")).toBe("no-cache");
    expect(cacheControlFor("/tenders/abc")).toBe("no-cache");
    expect(cacheControlFor("/favicon.svg")).toBe("no-cache");
  });

  it("caches content-hashed bundles immutably", () => {
    expect(cacheControlFor("/assets/index-Bx3k9.js")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(cacheControlFor("/assets/index-A1b2C.css")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("leaves API responses untouched", () => {
    expect(cacheControlFor("/api/trpc/data.getState")).toBeNull();
    expect(cacheControlFor("/api/auth/local")).toBeNull();
    expect(cacheControlFor("/api/oauth/callback")).toBeNull();
  });
});
