import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import { env } from "./lib/env";
import { getSessionCookieOptions } from "./lib/cookies";
import { Session } from "@contracts/constants";
import { signSessionToken } from "./kimi/session";
import { hashPassword, verifyPassword } from "./password";
import {
  findUserByUsername,
  setUserPassword,
  upsertUser,
} from "./queries/users";

// ---------------------------------------------------------------------------
// Standalone username/password login for self-hosted deployments where Kimi
// OAuth cannot be used (the OAuth server only trusts Kimi-hosted callback
// domains). Enabled only when ADMIN_USERNAME + ADMIN_PASSWORD are set; the
// env-backed admin account is provisioned lazily on first login and kept in
// sync with the env password. Local users get unionId = "local:<username>".
// ---------------------------------------------------------------------------

const LOCAL_UNION_PREFIX = "local:";
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 10 * 60 * 1000;

const attempts = new Map<string, { count: number; resetAt: number }>();

function clientKey(c: Context, username: string): string {
  const fwd = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = fwd || c.req.header("x-real-ip") || "unknown";
  return `${ip}:${username.toLowerCase()}`;
}

function isRateLimited(key: string): boolean {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(key: string): void {
  const entry = attempts.get(key);
  if (!entry || Date.now() > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: Date.now() + WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

export function localLoginEnabled(): boolean {
  return Boolean(env.adminUsername && env.adminPassword);
}

export async function authModesHandler(c: Context) {
  // Kimi OAuth is only offered when the platform app credentials exist —
  // self-hosted deployments (no APP_ID) get the local login form alone.
  return c.json({ kimi: Boolean(env.appId), local: localLoginEnabled() });
}

async function ensureEnvAdmin(): Promise<void> {
  // The env-backed admin account is the source of truth: create it on first
  // use, and re-sync the stored hash whenever ADMIN_PASSWORD changes.
  const username = env.adminUsername;
  const password = env.adminPassword;
  if (!username || !password) return;

  const existing = await findUserByUsername(username);
  if (!existing) {
    await upsertUser({
      unionId: `${LOCAL_UNION_PREFIX}${username.toLowerCase()}`,
      name: username,
      username,
      role: "admin",
      lastSignInAt: new Date(),
    });
    await setUserPassword(username, await hashPassword(password));
    return;
  }

  const matches =
    existing.passwordHash != null &&
    (await verifyPassword(password, existing.passwordHash));
  if (!matches) {
    await setUserPassword(username, await hashPassword(password));
  }
  if (existing.role !== "admin") {
    await upsertUser({
      unionId: existing.unionId,
      username,
      role: "admin",
      lastSignInAt: existing.lastSignInAt,
    });
  }
}

export async function localLoginHandler(c: Context) {
  if (!localLoginEnabled()) {
    return c.json({ error: "Local login is not enabled" }, 404);
  }

  let body: { username?: unknown; password?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) {
    return c.json({ error: "Username and password are required" }, 400);
  }

  const key = clientKey(c, username);
  if (isRateLimited(key)) {
    return c.json({ error: "Too many attempts. Try again later." }, 429);
  }

  // Keep the env-backed admin account provisioned and in sync.
  if (username.toLowerCase() === env.adminUsername.toLowerCase()) {
    await ensureEnvAdmin();
  }

  const user = await findUserByUsername(username);
  const ok =
    user?.passwordHash != null &&
    (await verifyPassword(password, user.passwordHash));
  if (!user || !ok) {
    recordFailure(key);
    return c.json({ error: "Invalid username or password" }, 401);
  }

  attempts.delete(key);

  await upsertUser({ unionId: user.unionId, lastSignInAt: new Date() });

  const token = await signSessionToken({
    unionId: user.unionId,
    // clientId must be non-empty (session verification requires it); on
    // self-hosted deployments without APP_ID use a fixed marker.
    clientId: env.appId || "local",
  });
  setCookie(c, Session.cookieName, token, {
    ...getSessionCookieOptions(c.req.raw.headers),
    maxAge: Session.maxAgeMs / 1000,
  });

  return c.json({ success: true, name: user.name ?? user.username });
}
