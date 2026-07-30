/**
 * FBV FleetOS — Traccar real-GPS poller.
 *
 * Polls a Traccar server (GET /api/devices + /api/positions) on a fixed
 * interval and keeps an in-memory cache:
 *   - devices keyed by uniqueId (tracker IMEI)
 *   - latest position per device
 *   - poll health (lastPollAt / lastError / consecutiveFailures)
 *
 * Traccar devices are mapped to FleetOS vehicles via the vehicles
 * collection's `deviceImei` field (entity JSON — no schema migration).
 * The mapping is refreshed every poll so IMEI edits take effect without
 * a restart.
 *
 * The poller NEVER throws and never blocks boot: failures only update
 * `lastError` and the router keeps serving the last-good cache.
 */

import { env } from "./lib/env";
import { listEntities } from "./queries/entities";
import type { LivePosition, VehicleStatus } from "../src/lib/types";

/* ---------------- Traccar API shapes (subset) ---------------- */

export interface TraccarDevice {
  id: number;
  name: string;
  uniqueId: string; // tracker IMEI
  status?: string;
  lastUpdate?: string;
}

export interface TraccarPosition {
  id: number;
  deviceId: number;
  latitude: number;
  longitude: number;
  /** knots */
  speed: number;
  /** degrees, 0 = north */
  course: number;
  deviceTime: string; // ISO
  attributes?: { ignition?: boolean } & Record<string, unknown>;
}

export interface TelematicsStatus {
  configured: boolean;
  connected: boolean;
  lastPollAt: string | null;
  lastError: string | null;
  deviceCount: number;
  mappedCount: number;
  pollMs: number;
  consecutiveFailures: number;
}

/** Vehicle subset needed for IMEI mapping (injectable for tests). */
export interface VehicleImeiRef {
  id: string;
  deviceImei?: string;
}

/* ---------------- module state ---------------- */

const STALE_MS = 10 * 60 * 1000; // fix older than 10 min → offline
const FETCH_TIMEOUT_MS = 8000;
const KNOTS_TO_KMH = 1.852;

const devicesByImei = new Map<string, TraccarDevice>();
const deviceIdToImei = new Map<number, string>();
const latestByDeviceId = new Map<number, TraccarPosition>();
/** IMEI → our vehicle id, refreshed every poll */
let imeiToVehicleId = new Map<string, string>();

let lastPollAt: number | null = null;
let lastError: string | null = null;
let consecutiveFailures = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let polling = false; // overlap guard

export function isConfigured(): boolean {
  return env.traccarUrl.length > 0;
}

function authHeaders(): Record<string, string> {
  if (env.traccarToken) {
    return { Authorization: `Bearer ${env.traccarToken}` };
  }
  if (env.traccarUser || env.traccarPass) {
    const basic = Buffer.from(`${env.traccarUser}:${env.traccarPass}`).toString("base64");
    return { Authorization: `Basic ${basic}` };
  }
  return {};
}

async function traccarGet<T>(path: string): Promise<T> {
  const res = await fetch(`${env.traccarUrl}${path}`, {
    headers: { ...authHeaders(), Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Traccar ${path} → HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/** Refresh the IMEI → vehicleId mapping from the vehicles collection. */
async function refreshMapping(vehicles?: VehicleImeiRef[]): Promise<void> {
  const list =
    vehicles ??
    ((await listEntities("vehicles")) as VehicleImeiRef[]);
  const map = new Map<string, string>();
  for (const v of list) {
    const imei = (v.deviceImei ?? "").trim();
    if (imei) map.set(imei, v.id);
  }
  imeiToVehicleId = map;
}

/** Convert one Traccar fix into a FleetOS LivePosition. */
export function toLivePosition(
  vehicleId: string,
  p: TraccarPosition,
  now = Date.now(),
): LivePosition {
  const speedKmh = Math.round(p.speed * KNOTS_TO_KMH);
  const at = Date.parse(p.deviceTime);
  const ignition = p.attributes?.ignition === true;
  let status: VehicleStatus;
  if (!Number.isFinite(at) || now - at > STALE_MS) {
    status = "offline";
  } else if (speedKmh > 3) {
    status = "moving";
  } else if (ignition) {
    status = "idling";
  } else {
    status = "stopped";
  }
  return {
    vehicleId,
    lat: p.latitude,
    lng: p.longitude,
    speedKmh,
    heading: Math.round(p.course ?? 0),
    ignition,
    status,
    at: Number.isFinite(at) ? at : now,
    source: "traccar",
  };
}

/**
 * One poll cycle. Exported (and vehicle-injectable) for tests.
 * On success the caches are replaced; on failure they are left untouched
 * so `getPositions()` keeps serving the last-good snapshot.
 */
export async function pollOnce(vehicles?: VehicleImeiRef[]): Promise<void> {
  if (!isConfigured()) return;
  try {
    const [devices, positions] = await Promise.all([
      traccarGet<TraccarDevice[]>("/api/devices"),
      traccarGet<TraccarPosition[]>("/api/positions"),
    ]);
    devicesByImei.clear();
    deviceIdToImei.clear();
    for (const d of devices) {
      devicesByImei.set(d.uniqueId, d);
      deviceIdToImei.set(d.id, d.uniqueId);
    }
    latestByDeviceId.clear();
    for (const p of positions) {
      // /api/positions returns the latest fix per device
      latestByDeviceId.set(p.deviceId, p);
    }
    await refreshMapping(vehicles);
    lastPollAt = Date.now();
    lastError = null;
    consecutiveFailures = 0;
  } catch (err) {
    consecutiveFailures += 1;
    lastError = err instanceof Error ? err.message : String(err);
  }
}

/** Start the interval poller (idempotent). No-op when unconfigured. */
export function ensurePoller(): void {
  if (!isConfigured() || timer) return;
  void pollOnce();
  timer = setInterval(() => {
    if (polling) return; // previous cycle still in flight
    polling = true;
    void pollOnce().finally(() => {
      polling = false;
    });
  }, env.traccarPollMs);
  // Never keep the node process alive just for telematics.
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}

/** Boot hook — starts the poller only when TRACCAR_URL is set. */
export function bootTelematics(): void {
  try {
    ensurePoller();
  } catch {
    // Poller startup must never crash boot.
  }
}

export function stopPoller(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export function getStatus(): TelematicsStatus {
  ensurePoller(); // lazy start on first request
  const configured = isConfigured();
  return {
    configured,
    connected: configured && lastPollAt !== null && lastError === null,
    lastPollAt: lastPollAt !== null ? new Date(lastPollAt).toISOString() : null,
    lastError,
    deviceCount: devicesByImei.size,
    mappedCount: imeiToVehicleId.size,
    pollMs: env.traccarPollMs,
    consecutiveFailures,
  };
}

/** Latest fixes for mapped vehicles, in FleetOS LivePosition form. */
export function getPositions(): LivePosition[] {
  ensurePoller(); // lazy start on first request
  const out: LivePosition[] = [];
  const now = Date.now();
  for (const [deviceId, p] of latestByDeviceId) {
    const imei = deviceIdToImei.get(deviceId);
    const vehicleId = imei ? imeiToVehicleId.get(imei) : undefined;
    if (!vehicleId) continue;
    out.push(toLivePosition(vehicleId, p, now));
  }
  return out;
}

/** Test hook — reset all module state. */
export function _resetTelematicsForTest(): void {
  stopPoller();
  devicesByImei.clear();
  deviceIdToImei.clear();
  latestByDeviceId.clear();
  imeiToVehicleId = new Map();
  lastPollAt = null;
  lastError = null;
  consecutiveFailures = 0;
  polling = false;
}
