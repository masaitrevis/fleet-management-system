// FBV FleetOS — route-replay derivation engine (tracking.md, trips.md).
// Historical trips store summary rows only; replay geometry is derived
// deterministically from the corridor polylines in src/lib/telematics.ts.
// "Smart logging": points are sampled adaptively — denser on turns and
// speed changes, sparse on straight cruise — mirroring real trackers.

import { corridorById, pointAt, prepareCorridor } from '@/lib/telematics';
import type { Geofence, SafetyEvent, Trip, Vehicle } from '@/lib/types';

/* ---------------- deterministic per (vehicle,date) RNG ---------------- */

function hashSeed(s: string): number {
  let h = 2166136261;
  for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- types ---------------- */

export interface ReplayPoint {
  lat: number;
  lng: number;
  heading: number;
  /** seconds since 00:00 EAT of the replay date */
  tSec: number;
  speedKmh: number;
  km: number; // distance along corridor
}

export type ReplayEventKind = 'harsh' | 'geofence' | 'stop' | 'idle' | 'trip';

export interface ReplayEvent {
  id: string;
  tSec: number;
  kind: ReplayEventKind;
  label: string;
  detail?: string;
  severity?: 'critical' | 'major' | 'minor' | 'info';
  lat: number;
  lng: number;
  tripId?: string;
}

export interface IdleSpan { fromKm: number; toKm: number; tStart: number; tEnd: number; }

export interface TripReplay {
  trip: Trip;
  dir: 1 | -1;
  startKm: number;
  endKm: number;
  /** dense display path (evenly spaced) */
  path: [number, number][];
  /** adaptively logged points (smart logging) — drives playback */
  points: ReplayPoint[];
  idleSpans: IdleSpan[];
  /** short road segments around each idle stop (amber dashed overlay) */
  idlePaths: [number, number][][];
  stopPoints: { lat: number; lng: number; tSec: number; label: string }[];
  events: ReplayEvent[];
  tStart: number;
  tEnd: number;
  stats: {
    distanceKm: number; driveMin: number; idleMin: number;
    maxSpeedKmh: number; avgSpeedKmh: number; harshCount: number; geofenceCount: number;
  };
}

export interface DayReplay {
  vehicleId: string;
  date: string; // YYYY-MM-DD
  trips: TripReplay[];
  events: ReplayEvent[];
  loggedPoints: number;
  windowStart: number; // seconds (default 06:00)
  windowEnd: number;   // seconds (default 22:00)
  dayStats: {
    distanceKm: number; driveMin: number; idleMin: number;
    maxSpeedKmh: number; avgSpeedKmh: number; harshCount: number; geofenceCount: number;
  };
}

/* ---------------- geo helpers ---------------- */

function distKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la = (aLat * Math.PI) / 180, lb = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function pointInPolygon(lat: number, lng: number, poly: { lat: number; lng: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lng, yi = poly[i].lat, xj = poly[j].lng, yj = poly[j].lat;
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInGeofence(lat: number, lng: number, gf: Geofence): boolean {
  if (gf.kind === 'circle' && gf.center && gf.radiusM) {
    return distKm(lat, lng, gf.center.lat, gf.center.lng) * 1000 <= gf.radiusM;
  }
  if (gf.kind === 'polygon' && gf.polygon && gf.polygon.length >= 3) {
    return pointInPolygon(lat, lng, gf.polygon);
  }
  return false;
}

/** seconds since 00:00 EAT for a UTC-shifted ISO demo timestamp */
export function isoToDaySec(iso: string): number {
  const d = new Date(iso);
  return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
}

export function secToHHMMSS(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function secToHHMM(sec: number): string {
  return secToHHMMSS(sec).slice(0, 5);
}

export function humanizeMin(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, '0')} m`;
}

/* ---------------- trip replay builder ---------------- */

const STEP_KM = 0.12; // dense path resolution

export function buildTripReplay(
  trip: Trip,
  tripIndexOnDay: number,
  safetyEvents: SafetyEvent[],
  geofences: Geofence[],
  seedKey: string,
): TripReplay {
  const c = prepareCorridor(trip.corridor);
  const rng = mulberry32(hashSeed(`${seedKey}:${trip.id}`));
  const tStart = isoToDaySec(trip.startAt);
  const tEnd = Math.max(tStart + 120, isoToDaySec(trip.endAt));
  const durationSec = tEnd - tStart;

  // Geometry window along corridor (alternate direction = return leg)
  const dir: 1 | -1 = tripIndexOnDay % 2 === 0 ? 1 : -1;
  const dist = Math.min(trip.distanceKm, c.lengthKm - 0.5);
  const margin = Math.max(0, c.lengthKm - dist - 0.4);
  const anchor = margin * (dir === 1 ? rng() * 0.4 : 0.6 + rng() * 0.4);
  const startKm = dir === 1 ? anchor : c.lengthKm - anchor;
  const endKm = dir === 1 ? startKm + dist : startKm - dist;

  // Speed profile: cruise band + slow zones (curves/towns) + idle stops
  const cruiseLo = c.speed[0], cruiseHi = Math.min(c.speed[1], trip.maxSpeedKmh - 4);
  const cruise = cruiseLo + rng() * (cruiseHi - cruiseLo);
  const nSlow = Math.max(1, Math.round(dist / 90));
  const slowZones: { km: number; width: number; factor: number }[] = [];
  for (let i = 0; i < nSlow; i++) {
    slowZones.push({ km: rng() * dist, width: 3 + rng() * 9, factor: 0.35 + rng() * 0.3 });
  }
  // idle stops along the route consuming trip.idleMin
  const idleStopMin: { atKm: number; minutes: number }[] = [];
  let idleLeft = Math.max(0, trip.idleMin);
  const nStops = idleLeft > 0 ? Math.min(3, Math.max(1, Math.round(idleLeft / 14))) : 0;
  for (let i = 0; i < nStops; i++) {
    const stopMin = i === nStops - 1 ? idleLeft : Math.max(2, idleLeft * (0.25 + rng() * 0.4));
    idleLeft -= stopMin;
    idleStopMin.push({ atKm: dist * (0.18 + rng() * 0.64), minutes: stopMin });
  }
  const idleSpans: IdleSpan[] = idleStopMin.map((s) => ({ fromKm: s.atKm, toKm: s.atKm, tStart: 0, tEnd: 0 }));

  // Dense walk with realistic speed integration
  const steps = Math.max(4, Math.round(dist / STEP_KM));
  const rawSpeed: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const d = (i / steps) * dist;
    const ramp = Math.min(1, Math.min(d, dist - d) / 1.2); // accel/decel near ends
    let v = cruise * (0.82 + 0.18 * Math.sin(d * 0.11 + tripIndexOnDay));
    for (const z of slowZones) {
      const w = Math.abs(d - z.km) / z.width;
      if (w < 1) v *= 1 - (1 - z.factor) * (1 - w * w);
    }
    v = Math.max(6, Math.min(trip.maxSpeedKmh, v * ramp + 6 * (1 - ramp)));
    rawSpeed.push(v);
  }
  // integrate moving time, then scale to (duration - idle)
  const idleSec = Math.min(durationSec * 0.6, Math.max(0, trip.idleMin) * 60);
  const moveTarget = durationSec - idleSec;
  let moveRaw = 0;
  for (let i = 0; i < steps; i++) moveRaw += (STEP_KM / ((rawSpeed[i] + rawSpeed[i + 1]) / 2)) * 3600;
  const scale = moveRaw > 0 ? moveTarget / moveRaw : 1;

  // assign timestamps; distribute idle spans at their km positions
  const kmOf = (i: number) => (dir === 1 ? startKm + (i / steps) * dist : startKm - (i / steps) * dist);
  const dense: ReplayPoint[] = [];
  let t = tStart;
  let idleIdx = 0;
  for (let i = 0; i <= steps; i++) {
    const d = (i / steps) * dist;
    const pt = pointAt(c, kmOf(i));
    const heading = dir === 1 ? pt.heading : (pt.heading + 180) % 360;
    dense.push({ lat: pt.lat, lng: pt.lng, heading, tSec: t, speedKmh: rawSpeed[i], km: kmOf(i) });
    if (i < steps) t += ((STEP_KM / ((rawSpeed[i] + rawSpeed[i + 1]) / 2)) * 3600) * scale;
    // insert idle stop when passing its km
    while (idleIdx < idleStopMin.length && d + STEP_KM >= idleStopMin[idleIdx].atKm && i < steps - 2) {
      const stopSec = idleStopMin[idleIdx].minutes * 60;
      idleSpans[idleIdx].tStart = t;
      idleSpans[idleIdx].tEnd = t + stopSec;
      t += stopSec;
      idleIdx++;
    }
  }
  // renormalize drift so the walk ends exactly at trip end
  const drift = tEnd - t;
  if (Math.abs(drift) > 1 && dense.length > 1) {
    const t0 = dense[0].tSec, t1 = dense[dense.length - 1].tSec;
    const target = t1 + drift;
    for (const p of dense) p.tSec = t0 + ((p.tSec - t0) / Math.max(1, t1 - t0)) * (target - t0);
    for (const s of idleSpans) {
      s.tStart = t0 + ((s.tStart - t0) / Math.max(1, t1 - t0)) * (target - t0);
      s.tEnd = t0 + ((s.tEnd - t0) / Math.max(1, t1 - t0)) * (target - t0);
    }
  }
  dense[dense.length - 1].tSec = tEnd;

  // mark idle speeds to 0 within spans (for curve + bands)
  for (const s of idleSpans) {
    for (const p of dense) if (p.tSec >= s.tStart && p.tSec <= s.tEnd) p.speedKmh = 0;
  }

  // Smart logging: keep points where heading/speed change, sparse on cruise
  const logged: ReplayPoint[] = [dense[0]];
  let lastKeptKm = dense[0].km;
  for (let i = 1; i < dense.length - 1; i++) {
    const p = dense[i];
    const dHead = Math.abs(p.heading - dense[i - 1].heading);
    const dSpeed = Math.abs(p.speedKmh - dense[i - 1].speedKmh);
    const inIdle = idleSpans.some((s) => p.tSec >= s.tStart && p.tSec <= s.tEnd);
    const keep =
      dHead > 7 || dSpeed > 9 || inIdle ||
      Math.abs(p.km - lastKeptKm) > (c.city ? 0.35 : 2.2);
    if (keep) { logged.push(p); lastKeptKm = p.km; }
  }
  logged.push(dense[dense.length - 1]);

  // events ------------------------------------------------------------
  const events: ReplayEvent[] = [];
  const startPt = dense[0], endPt = dense[dense.length - 1];
  events.push({
    id: `${trip.id}-dep`, tSec: tStart, kind: 'trip',
    label: `Departed ${trip.from}`, detail: `Trip start — ${trip.from} → ${trip.to}`,
    lat: startPt.lat, lng: startPt.lng, tripId: trip.id, severity: 'info',
  });
  events.push({
    id: `${trip.id}-arr`, tSec: tEnd, kind: 'stop',
    label: `Arrived ${trip.to}`, detail: `Trip end — ${humanizeMin(trip.durationMin)}, ${trip.distanceKm} km`,
    lat: endPt.lat, lng: endPt.lng, tripId: trip.id, severity: 'info',
  });

  // harsh/safety events inside this trip's window
  safetyEvents
    .filter((e) => {
      const s = isoToDaySec(e.at);
      return s >= tStart && s <= tEnd;
    })
    .forEach((e) => {
      const s = isoToDaySec(e.at);
      const frac = (s - tStart) / Math.max(1, tEnd - tStart);
      const idx = Math.min(dense.length - 1, Math.max(0, Math.round(frac * (dense.length - 1))));
      const p = dense[idx];
      const drop = Math.max(18, Math.round((e.speedKmh ?? 70) * (0.35 + rng() * 0.3)));
      events.push({
        id: `${trip.id}-${e.id}`, tSec: s, kind: 'harsh',
        label: e.type.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()),
        detail: `${secToHHMMSS(s)} · ${Math.round(e.speedKmh ?? p.speedKmh)}→${Math.max(8, Math.round((e.speedKmh ?? 70) - drop))} km/h — ${e.location}`,
        severity: e.severity, lat: p.lat, lng: p.lng, tripId: trip.id,
      });
    });

  // geofence crossings along the dense path
  for (const gf of geofences) {
    let inside = false;
    let enterIdx = -1;
    for (let i = 0; i < dense.length; i++) {
      const p = dense[i];
      const now = pointInGeofence(p.lat, p.lng, gf);
      if (now && !inside) {
        inside = true; enterIdx = i;
        events.push({
          id: `${trip.id}-${gf.id}-in`, tSec: p.tSec, kind: 'geofence',
          label: `Entered ${gf.name}`, detail: `${secToHHMM(p.tSec)} — ${gf.name}`,
          severity: 'info', lat: p.lat, lng: p.lng, tripId: trip.id,
        });
      } else if (!now && inside) {
        inside = false;
        const dwell = (p.tSec - dense[Math.max(0, enterIdx)].tSec) / 60;
        events.push({
          id: `${trip.id}-${gf.id}-out`, tSec: p.tSec, kind: 'geofence',
          label: `Exited ${gf.name}`, detail: `${secToHHMM(p.tSec)} — dwell ${humanizeMin(dwell)}`,
          severity: 'info', lat: p.lat, lng: p.lng, tripId: trip.id,
        });
      }
    }
  }

  // idle/stop events
  idleSpans.forEach((s, i) => {
    const idx = dense.findIndex((p) => p.tSec >= s.tStart);
    const p = dense[Math.max(0, idx)];
    events.push({
      id: `${trip.id}-idle-${i}`, tSec: s.tStart, kind: 'idle',
      label: `Idle stop ${humanizeMin((s.tEnd - s.tStart) / 60)}`,
      detail: `${secToHHMM(s.tStart)} → ${secToHHMM(s.tEnd)}`,
      severity: 'minor', lat: p.lat, lng: p.lng, tripId: trip.id,
    });
  });

  events.sort((a, b) => a.tSec - b.tSec);

  // amber overlay segment around each idle stop (~±0.5 km of road)
  const idlePaths = idleSpans.map((s) => {
    const idx = dense.findIndex((p) => p.tSec >= s.tStart);
    const i = Math.max(0, idx);
    return dense.slice(Math.max(0, i - 4), Math.min(dense.length, i + 5))
      .map((p) => [p.lat, p.lng] as [number, number]);
  });

  const harshCount = events.filter((e) => e.kind === 'harsh').length;
  const geofenceCount = events.filter((e) => e.kind === 'geofence').length;
  const driveMin = Math.max(1, (tEnd - tStart) / 60 - trip.idleMin);
  return {
    trip, dir, startKm, endKm,
    path: dense.map((p) => [p.lat, p.lng] as [number, number]),
    points: logged,
    idleSpans,
    idlePaths,
    stopPoints: [
      { lat: startPt.lat, lng: startPt.lng, tSec: tStart, label: `Start ${secToHHMM(tStart)}` },
      ...idleSpans.map((s) => {
        const idx = dense.findIndex((p) => p.tSec >= s.tStart);
        const p = dense[Math.max(0, idx)];
        return { lat: p.lat, lng: p.lng, tSec: s.tStart, label: `Idle ${humanizeMin((s.tEnd - s.tStart) / 60)}` };
      }),
      { lat: endPt.lat, lng: endPt.lng, tSec: tEnd, label: `End ${secToHHMM(tEnd)}` },
    ],
    events, tStart, tEnd,
    stats: {
      distanceKm: trip.distanceKm, driveMin, idleMin: trip.idleMin,
      maxSpeedKmh: trip.maxSpeedKmh,
      avgSpeedKmh: driveMin > 0 ? trip.distanceKm / (driveMin / 60) : 0,
      harshCount, geofenceCount,
    },
  };
}

/* ---------------- day replay builder ---------------- */

export function buildDayReplay(
  vehicle: Vehicle,
  date: string,
  trips: Trip[],
  safetyEvents: SafetyEvent[],
  geofences: Geofence[],
): DayReplay {
  const dayTrips = trips
    .filter((t) => t.vehicleId === vehicle.id && t.startAt.slice(0, 10) === date)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const daySafety = safetyEvents.filter(
    (e) => e.vehicleId === vehicle.id && e.at.slice(0, 10) === date,
  );
  const seedKey = `${vehicle.id}:${date}`;
  const tripReplays = dayTrips.map((t, i) => buildTripReplay(t, i, daySafety, geofences, seedKey));
  const events = tripReplays.flatMap((r) => r.events).sort((a, b) => a.tSec - b.tSec);

  const earliest = tripReplays.length ? Math.min(...tripReplays.map((r) => r.tStart)) : 6 * 3600;
  const latest = tripReplays.length ? Math.max(...tripReplays.map((r) => r.tEnd)) : 22 * 3600;
  const windowStart = Math.min(6 * 3600, Math.floor(earliest / 3600) * 3600);
  const windowEnd = Math.max(22 * 3600, Math.ceil(latest / 3600) * 3600);

  const sum = (f: (r: TripReplay) => number) => tripReplays.reduce((s, r) => s + f(r), 0);
  const distanceKm = sum((r) => r.stats.distanceKm);
  const driveMin = sum((r) => r.stats.driveMin);
  return {
    vehicleId: vehicle.id, date, trips: tripReplays, events,
    loggedPoints: tripReplays.reduce((s, r) => s + r.points.length, 0),
    windowStart, windowEnd,
    dayStats: {
      distanceKm, driveMin, idleMin: sum((r) => r.stats.idleMin),
      maxSpeedKmh: tripReplays.reduce((m, r) => Math.max(m, r.stats.maxSpeedKmh), 0),
      avgSpeedKmh: driveMin > 0 ? distanceKm / (driveMin / 60) : 0,
      harshCount: sum((r) => r.stats.harshCount),
      geofenceCount: sum((r) => r.stats.geofenceCount),
    },
  };
}

/** Interpolate replay state at a wall-clock second within a trip. */
export function sampleTripAt(replay: TripReplay, tSec: number): ReplayPoint | null {
  const pts = replay.points;
  if (pts.length === 0 || tSec < pts[0].tSec || tSec > pts[pts.length - 1].tSec) return null;
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].tSec <= tSec) lo = mid; else hi = mid;
  }
  const a = pts[lo], b = pts[hi];
  const span = Math.max(1e-6, b.tSec - a.tSec);
  const f = Math.max(0, Math.min(1, (tSec - a.tSec) / span));
  return {
    lat: a.lat + (b.lat - a.lat) * f,
    lng: a.lng + (b.lng - a.lng) * f,
    heading: a.heading + ((((b.heading - a.heading + 540) % 360) - 180) * f),
    tSec,
    speedKmh: a.speedKmh + (b.speedKmh - a.speedKmh) * f,
    km: a.km + (b.km - a.km) * f,
  };
}

/** Nearest logged position when the playhead sits between trips. */
export function parkedAt(day: DayReplay, tSec: number): ReplayPoint | null {
  if (day.trips.length === 0) return null;
  let best: ReplayPoint | null = null;
  for (const r of day.trips) {
    if (tSec >= r.tEnd) best = r.points[r.points.length - 1];
    if (tSec < r.tStart && !best) best = r.points[0];
  }
  return best ? { ...best, tSec, speedKmh: 0 } : { ...day.trips[0].points[0], tSec, speedKmh: 0 };
}

export { corridorById };
