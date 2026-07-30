import "dotenv/config";
import { createHash } from "node:crypto";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

// Self-hosted deployments (Render, Docker, VPS) do not have the Kimi platform
// variables. The Kimi-related values are therefore LAZY getters: a missing
// value only matters if Kimi OAuth is actually invoked, and the app boots
// fine without them. Session JWTs never fall back to an empty/known key —
// when APP_SECRET is unset we derive a deployment-unique secret from the
// database URL + admin password (both secret themselves).
function fallbackSessionSecret(): string {
  const material = `fbv-fleet-session:${process.env.DATABASE_URL ?? ""}:${process.env.ADMIN_PASSWORD ?? ""}`;
  return createHash("sha256").update(material).digest("hex");
}

export const env = {
  get appId() {
    return process.env.APP_ID ?? "";
  },
  get appSecret() {
    return (
      process.env.APP_SECRET ??
      process.env.SESSION_SECRET ??
      fallbackSessionSecret()
    );
  },
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: required("DATABASE_URL"),
  get kimiAuthUrl() {
    return process.env.KIMI_AUTH_URL ?? "";
  },
  get kimiOpenUrl() {
    return process.env.KIMI_OPEN_URL ?? "";
  },
  ownerUnionId: process.env.OWNER_UNION_ID ?? "",
  // Optional standalone (username/password) login for self-hosted deployments
  // where Kimi OAuth is unavailable. Getters so tests can set env at runtime.
  get adminUsername() {
    return process.env.ADMIN_USERNAME ?? "";
  },
  get adminPassword() {
    return process.env.ADMIN_PASSWORD ?? "";
  },
};
