/**
 * Standalone (username/password) login tests — runs against the REAL dev DB.
 * Covers scrypt hash/verify, /api/auth/modes gating, the full login handler
 * flow (env-admin lazy provisioning, wrong password, success + session JWT),
 * and leaves no test rows behind.
 */
import { afterAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { hashPassword, verifyPassword } from "./password";
import {
  authModesHandler,
  localLoginHandler,
} from "./local-auth";
import { verifySessionToken } from "./kimi/session";
import { getDb } from "./queries/connection";
import * as schema from "@db/schema";
import { like } from "drizzle-orm";

const TEST_USER = "tst-admin";
const TEST_PASS = "Sup3r!SecretPass";

const app = new Hono();
app.get("/api/auth/modes", authModesHandler);
app.post("/api/auth/local", localLoginHandler);

function postLogin(body: unknown) {
  return app.request("/api/auth/local", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("password util", () => {
  it("hash + verify round-trips", async () => {
    const hash = await hashPassword("hunter2");
    expect(hash.startsWith("s2$")).toBe(true);
    expect(await verifyPassword("hunter2", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("hunter3", hash)).toBe(false);
  });

  it("rejects malformed hashes", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "s2$bad$r$p$salt$hash")).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
  });

  it("produces unique salts (same password → different hashes)", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  });
});

describe("auth modes + login handler", () => {
  it("reports local login disabled when env creds are unset", async () => {
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD;
    const resp = await app.request("/api/auth/modes");
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as { kimi: boolean; local: boolean };
    expect(json.local).toBe(false);
  });

  it("rejects login with 404 when disabled", async () => {
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD;
    const resp = await postLogin({ username: "a", password: "b" });
    expect(resp.status).toBe(404);
  });

  it("reports local login enabled when env creds are set", async () => {
    process.env.ADMIN_USERNAME = TEST_USER;
    process.env.ADMIN_PASSWORD = TEST_PASS;
    const resp = await app.request("/api/auth/modes");
    const json = (await resp.json()) as { local: boolean };
    expect(json.local).toBe(true);
  });

  it("validates the request body", async () => {
    process.env.ADMIN_USERNAME = TEST_USER;
    process.env.ADMIN_PASSWORD = TEST_PASS;
    expect((await postLogin({ username: "", password: "x" })).status).toBe(400);
    expect((await postLogin({ username: TEST_USER })).status).toBe(400);
    expect((await postLogin("nope")).status).toBe(400);
  });

  it("rejects a wrong password with 401 (and provisions the env admin)", async () => {
    process.env.ADMIN_USERNAME = TEST_USER;
    process.env.ADMIN_PASSWORD = TEST_PASS;
    const resp = await postLogin({ username: TEST_USER, password: "wrong" });
    expect(resp.status).toBe(401);
    const json = (await resp.json()) as { error: string };
    expect(json.error).toMatch(/invalid/i);

    // Provisioning should have happened even though the password was wrong
    const rows = await getDb()
      .select()
      .from(schema.users)
      .where(like(schema.users.unionId, `local:${TEST_USER}%`));
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("admin");
    expect(rows[0].username).toBe(TEST_USER);
    expect(rows[0].passwordHash?.startsWith("s2$")).toBe(true);
  });

  it("rejects an unknown user with 401", async () => {
    const resp = await postLogin({ username: "no-such-user", password: "x" });
    expect(resp.status).toBe(401);
  });

  it("logs in with correct credentials and sets a valid session cookie", async () => {
    process.env.ADMIN_USERNAME = TEST_USER;
    process.env.ADMIN_PASSWORD = TEST_PASS;
    const resp = await postLogin({ username: TEST_USER, password: TEST_PASS });
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as { success: boolean; name: string };
    expect(json.success).toBe(true);

    const setCookie = resp.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("kimi_sid=");
    expect(setCookie.toLowerCase()).toContain("httponly");

    const token = /kimi_sid=([^;]+)/.exec(setCookie)?.[1] ?? "";
    const claim = await verifySessionToken(decodeURIComponent(token));
    expect(claim?.unionId).toBe(`local:${TEST_USER}`);
  });

  it("re-syncs the stored hash when ADMIN_PASSWORD changes", async () => {
    process.env.ADMIN_USERNAME = TEST_USER;
    process.env.ADMIN_PASSWORD = "NewP@ssw0rd!";
    const resp = await postLogin({ username: TEST_USER, password: "NewP@ssw0rd!" });
    expect(resp.status).toBe(200);
    // old password no longer works
    const old = await postLogin({ username: TEST_USER, password: TEST_PASS });
    expect(old.status).toBe(401);
  });
});

afterAll(async () => {
  await getDb()
    .delete(schema.users)
    .where(like(schema.users.unionId, "local:%"));
  delete process.env.ADMIN_USERNAME;
  delete process.env.ADMIN_PASSWORD;
});
