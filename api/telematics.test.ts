/**
 * FBV FleetOS — Traccar telematics suite (mocked global.fetch, no live
 * Traccar server, no DB needed for the poller tests — the IMEI→vehicle
 * mapping is injected via pollOnce(vehicles)).
 *
 * Covers: auth guards (401), unconfigured behaviour, device→vehicle mapping
 * by IMEI, knots→km/h conversion, moving/idling/stopped/offline derivation,
 * stale-fix (>10 min) → offline, and failure handling (lastError set,
 * last-good cache served, no throw).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./router";
import {
  _resetTelematicsForTest,
  getPositions,
  getStatus,
  pollOnce,
  toLivePosition,
  type TraccarDevice,
  type TraccarPosition,
  type VehicleImeiRef,
} from "./telematics";
import type { User } from "@db/schema";

const TRACCAR = "http://traccar.test:8082";

const adminUser = {
  id: 1,
  unionId: "telematics-test",
  name: "Telematics Bot",
  role: "admin",
} as unknown as User;

const authed = appRouter.createCaller({
  req: new Request("http://test.local"),
  resHeaders: new Headers(),
  user: adminUser,
});
const anon = appRouter.createCaller({
  req: new Request("http://test.local"),
  resHeaders: new Headers(),
});

const VEHICLES: VehicleImeiRef[] = [
  { id: "veh-t01", deviceImei: "861234567890001" },
  { id: "veh-t02", deviceImei: "861234567890002" },
  { id: "veh-t03", deviceImei: "861234567890003" },
  { id: "veh-t04", deviceImei: "861234567890004" },
  { id: "veh-sim", deviceImei: "" }, // stays simulated
];

function device(id: number, imei: string): TraccarDevice {
  return { id, name: `Tracker ${id}`, uniqueId: imei, status: "online" };
}

function position(
  deviceId: number,
  over: Partial<TraccarPosition> = {},
): TraccarPosition {
  return {
    id: deviceId * 100,
    deviceId,
    latitude: -1.2921,
    longitude: 36.8219,
    speed: 0,
    course: 90,
    deviceTime: new Date().toISOString(),
    attributes: {},
    ...over,
  };
}

function mockFetch(payloads: {
  devices?: TraccarDevice[];
  positions?: TraccarPosition[];
  fail?: boolean;
}) {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    if (payloads.fail || !url.startsWith(TRACCAR)) {
      throw new Error("connect ECONNREFUSED traccar.test:8082");
    }
    const body = url.includes("/api/devices")
      ? (payloads.devices ?? [])
      : (payloads.positions ?? []);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

function expectUnauthorized(p: Promise<unknown>) {
  return expect(p).rejects.toSatisfy(
    (e) =>
      (e as { data?: { code?: string } }).data?.code === "UNAUTHORIZED" ||
      (e as { code?: string }).code === "UNAUTHORIZED" ||
      String(e).includes("UNAUTHORIZED"),
  );
}

beforeEach(() => {
  _resetTelematicsForTest();
  delete process.env.TRACCAR_URL;
  delete process.env.TRACCAR_TOKEN;
  delete process.env.TRACCAR_USER;
  delete process.env.TRACCAR_PASS;
  delete process.env.TRACCAR_POLL_MS;
});

afterEach(() => {
  vi.unstubAllGlobals();
  _resetTelematicsForTest();
  delete process.env.TRACCAR_URL;
});

describe("auth guards", () => {
  it("rejects unauthenticated status + positions with UNAUTHORIZED", async () => {
    await expectUnauthorized(anon.telematics.status());
    await expectUnauthorized(anon.telematics.positions());
  });
});

describe("unconfigured (no TRACCAR_URL)", () => {
  it("status.configured is false and positions is empty", async () => {
    const status = await authed.telematics.status();
    expect(status.configured).toBe(false);
    expect(status.connected).toBe(false);
    expect(status.deviceCount).toBe(0);
    expect(status.mappedCount).toBe(0);
    expect(status.pollMs).toBe(10000);
    expect(await authed.telematics.positions()).toEqual([]);
  });
});

describe("poller mapping + conversion", () => {
  beforeEach(() => {
    process.env.TRACCAR_URL = TRACCAR;
    process.env.TRACCAR_TOKEN = "tok-abc";
  });

  it("maps devices by IMEI, converts knots→km/h, derives statuses", async () => {
    const stale = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    vi.stubGlobal(
      "fetch",
      mockFetch({
        devices: [
          device(1, "861234567890001"),
          device(2, "861234567890002"),
          device(3, "861234567890003"),
          device(4, "861234567890004"),
          device(9, "869999999999999"), // unmapped — no vehicle with this IMEI
        ],
        positions: [
          position(1, { speed: 20, course: 87, attributes: { ignition: true } }), // 37 km/h → moving
          position(2, { speed: 1, attributes: { ignition: true } }),              // 2 km/h + ign → idling
          position(3, { speed: 0, attributes: { ignition: false } }),             // stopped
          position(4, { speed: 25, deviceTime: stale }),                          // stale → offline
          position(9, { speed: 30 }),                                             // unmapped → dropped
        ],
      }),
    );

    await pollOnce(VEHICLES);
    const rows = getPositions();

    expect(rows).toHaveLength(4); // unmapped device excluded
    const byId = new Map(rows.map((r) => [r.vehicleId, r]));

    const moving = byId.get("veh-t01");
    expect(moving?.status).toBe("moving");
    expect(moving?.speedKmh).toBe(37); // 20 kn × 1.852 = 37.04 → 37
    expect(moving?.heading).toBe(87);
    expect(moving?.source).toBe("traccar");
    expect(moving?.ignition).toBe(true);

    expect(byId.get("veh-t02")?.status).toBe("idling");
    expect(byId.get("veh-t03")?.status).toBe("stopped");
    expect(byId.get("veh-t04")?.status).toBe("offline"); // stale > 10 min
    // offline keeps its last known fix
    expect(byId.get("veh-t04")?.lat).toBeCloseTo(-1.2921);

    const status = getStatus();
    expect(status.configured).toBe(true);
    expect(status.connected).toBe(true);
    expect(status.lastError).toBeNull();
    expect(status.deviceCount).toBe(5);
    expect(status.mappedCount).toBe(4);
    expect(status.lastPollAt).not.toBeNull();
  });

  it("flags a fix older than 10 minutes as offline (unit)", () => {
    const now = Date.now();
    const fresh = toLivePosition(
      "veh-x",
      position(1, { speed: 30, deviceTime: new Date(now - 9 * 60 * 1000).toISOString() }),
      now,
    );
    expect(fresh.status).toBe("moving");
    const stale = toLivePosition(
      "veh-x",
      position(1, { speed: 30, deviceTime: new Date(now - 10 * 60 * 1000 - 1).toISOString() }),
      now,
    );
    expect(stale.status).toBe("offline");
  });

  it("fetch failure sets lastError, keeps last-good cache, never throws", async () => {
    // one good poll to prime the cache
    vi.stubGlobal(
      "fetch",
      mockFetch({
        devices: [device(1, "861234567890001")],
        positions: [position(1, { speed: 15 })],
      }),
    );
    await pollOnce(VEHICLES);
    expect(getPositions()).toHaveLength(1);
    expect(getStatus().connected).toBe(true);

    // Traccar goes down — poll must not throw and cache must survive
    vi.stubGlobal("fetch", mockFetch({ fail: true }));
    await expect(pollOnce(VEHICLES)).resolves.toBeUndefined();

    const status = getStatus();
    expect(status.connected).toBe(false);
    expect(status.lastError).toContain("ECONNREFUSED");

    const rows = getPositions();
    expect(rows).toHaveLength(1);
    expect(rows[0].vehicleId).toBe("veh-t01");
    expect(rows[0].speedKmh).toBe(28); // last-good 15 kn × 1.852 = 27.78 → 28
  });

  it("uses Bearer token auth header when TRACCAR_TOKEN is set", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (input: unknown, init?: { headers?: Record<string, string> }) => {
      seen.push(init?.headers?.Authorization ?? "");
      return new Response("[]", { status: 200 });
    });
    await pollOnce(VEHICLES);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((h) => h === "Bearer tok-abc")).toBe(true);
  });

  it("falls back to Basic auth with TRACCAR_USER + TRACCAR_PASS", async () => {
    delete process.env.TRACCAR_TOKEN;
    process.env.TRACCAR_USER = "admin";
    process.env.TRACCAR_PASS = "s3cret";
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (input: unknown, init?: { headers?: Record<string, string> }) => {
      seen.push(init?.headers?.Authorization ?? "");
      return new Response("[]", { status: 200 });
    });
    await pollOnce(VEHICLES);
    const expected = `Basic ${Buffer.from("admin:s3cret").toString("base64")}`;
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((h) => h === expected)).toBe(true);
  });
});
