import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

export const env = {
  appId: required("APP_ID"),
  appSecret: required("APP_SECRET"),
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: required("DATABASE_URL"),
  kimiAuthUrl: required("KIMI_AUTH_URL"),
  kimiOpenUrl: required("KIMI_OPEN_URL"),
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
