// FBV FleetOS — telematics abstraction + built-in simulator (design.md §8)
// The backend phase can implement TelematicsProvider over HTTP/webhooks
// (Teltonika/Concox/Geotab GO) without touching consumers.

import type { LivePosition, VehicleStatus } from './types';

/* ------------------------------------------------------------------ */
/* Corridor polylines (realistic waypoints, lat/lng)                   */
/* ------------------------------------------------------------------ */

export interface Corridor {
  id: string;
  name: string;
  /** [lat, lng] waypoints */
  points: [number, number][];
  /** typical cruise speed band km/h */
  speed: [number, number];
  city?: boolean;
}

export const CORRIDORS: Corridor[] = [
  {
    id: 'a109', name: 'A109 Nairobi–Mombasa', speed: [65, 92],
    points: [
      [-1.3031, 36.8526], [-1.3320, 36.8980], [-1.3650, 36.9430], [-1.4010, 36.9680],
      [-1.4563, 36.9783], [-1.5200, 37.0500], [-1.5850, 37.1400], [-1.7000, 37.2600],
      [-1.7900, 37.3600], [-1.9300, 37.5100], [-2.0900, 37.6200], [-2.2500, 37.7600],
      [-2.4167, 37.9667], [-2.5800, 38.1300], [-2.7500, 38.2900], [-2.9500, 38.4200],
      [-3.1000, 38.5000], [-3.2500, 38.5200], [-3.3960, 38.5561], [-3.5000, 38.7500],
      [-3.5600, 38.9600], [-3.6300, 39.1700], [-3.7200, 39.3300], [-3.8667, 39.4667],
      [-3.9500, 39.5600], [-4.0100, 39.6200], [-4.0435, 39.6682],
    ],
  },
  {
    id: 'a104', name: 'A104 Nairobi–Nakuru', speed: [55, 85],
    points: [
      [-1.2921, 36.8219], [-1.2635, 36.8029], [-1.2400, 36.7600], [-1.2100, 36.7000],
      [-1.1700, 36.6600], [-1.1067, 36.6417], [-1.0400, 36.6100], [-0.9600, 36.5500],
      [-0.8800, 36.4700], [-0.7800, 36.4400], [-0.7167, 36.4310], [-0.6400, 36.3900],
      [-0.5600, 36.3500], [-0.4967, 36.3200], [-0.4200, 36.2400], [-0.3600, 36.1600],
      [-0.3031, 36.0800],
    ],
  },
  {
    id: 'a2', name: 'A2 Nairobi–Thika', speed: [45, 80],
    points: [
      [-1.2864, 36.8172], [-1.2650, 36.8350], [-1.2450, 36.8620], [-1.2167, 36.9000],
      [-1.1900, 36.9250], [-1.1650, 36.9450], [-1.1467, 36.9600], [-1.1200, 36.9850],
      [-1.1017, 37.0117], [-1.0700, 37.0400], [-1.0332, 37.0692],
    ],
  },
  {
    id: 'city-west', name: 'City loop — Westlands', speed: [18, 42], city: true,
    points: [
      [-1.2921, 36.8219], [-1.2760, 36.8150], [-1.2635, 36.8029], [-1.2540, 36.7950],
      [-1.2450, 36.7850], [-1.2520, 36.7750], [-1.2680, 36.7890], [-1.2820, 36.8060],
      [-1.2921, 36.8219],
    ],
  },
  {
    id: 'city-industrial', name: 'City loop — Industrial Area', speed: [18, 40], city: true,
    points: [
      [-1.2921, 36.8219], [-1.3000, 36.8380], [-1.3031, 36.8526], [-1.3150, 36.8620],
      [-1.3280, 36.8560], [-1.3200, 36.8400], [-1.3050, 36.8280], [-1.2921, 36.8219],
    ],
  },
];

export const DEPOT = { lat: -1.3031, lng: 36.8526, name: 'FBV Depot — Industrial Area, Likoni Rd' };
export const NAIROBI_CENTER: [number, number] = [-1.2921, 36.8219];

export function corridorById(id: string): Corridor {
  return CORRIDORS.find((c) => c.id === id) ?? CORRIDORS[0];
}

/* ---------------- polyline math ---------------- */

const R = 6371; // km
function haversine(a: [number, number], b: [number, number]): number {
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const la = (a[0] * Math.PI) / 180;
  const lb = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearing(a: [number, number], b: [number, number]): number {
  const la = (a[0] * Math.PI) / 180, lb = (b[0] * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lb);
  const x = Math.cos(la) * Math.sin(lb) - Math.sin(la) * Math.cos(lb) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export interface PreparedCorridor extends Corridor {
  cumKm: number[];   // cumulative km at each waypoint
  lengthKm: number;
}

const prepared = new Map<string, PreparedCorridor>();
export function prepareCorridor(id: string): PreparedCorridor {
  const hit = prepared.get(id);
  if (hit) return hit;
  const c = corridorById(id);
  const cumKm = [0];
  for (let i = 1; i < c.points.length; i++) cumKm.push(cumKm[i - 1] + haversine(c.points[i - 1], c.points[i]));
  const p = { ...c, cumKm, lengthKm: cumKm[cumKm.length - 1] };
  prepared.set(id, p);
  return p;
}

/** Interpolate a point + heading at distance km along the corridor. */
export function pointAt(c: PreparedCorridor, km: number): { lat: number; lng: number; heading: number } {
  const d = Math.max(0, Math.min(km, c.lengthKm - 0.0001));
  let i = 0;
  while (i < c.cumKm.length - 2 && c.cumKm[i + 1] < d) i++;
  const seg = c.cumKm[i + 1] - c.cumKm[i] || 1e-6;
  const t = (d - c.cumKm[i]) / seg;
  const a = c.points[i], b = c.points[i + 1];
  return {
    lat: a[0] + (b[0] - a[0]) * t,
    lng: a[1] + (b[1] - a[1]) * t,
    heading: bearing(a, b),
  };
}

/* ------------------------------------------------------------------ */
/* TelematicsProvider interface                                        */
/* ------------------------------------------------------------------ */

export interface TelematicsEvent {
  kind: 'harsh_braking' | 'harsh_acceleration' | 'harsh_cornering' | 'speeding' | 'trip_completed';
  vehicleId: string;
  at: string;
  location: string;
  speedKmh?: number;
}

export interface TelematicsProvider {
  readonly name: string;
  start(): void;
  stop(): void;
  isRunning(): boolean;
  /** Subscribe to position snapshots (called every tick with all devices). */
  subscribe(cb: (positions: Map<string, LivePosition>) => void): () => void;
  /** Optional operational events (harsh events etc.) */
  onEvent?(cb: (e: TelematicsEvent) => void): () => void;
  /** Recent trail points per vehicle (oldest first). */
  trail(vehicleId: string): [number, number][];
}

/* ------------------------------------------------------------------ */
/* Built-in simulator                                                  */
/* ------------------------------------------------------------------ */

export interface SimVehicleConfig {
  vehicleId: string;
  corridorId: string;
  /** initial distance along corridor, km */
  startKm: number;
  mode: 'shuttle' | 'parked' | 'idling' | 'offline';
  /** for parked/idling: fixed position */
  parkedAt?: [number, number];
}

interface SimState {
  cfg: SimVehicleConfig;
  km: number;
  dir: 1 | -1;
  speedKmh: number;
  targetSpeed: number;
  mode: 'moving' | 'idle' | 'dwell' | 'offline';
  ticksLeft: number; // remaining ticks in idle/dwell mode
  lat: number;
  lng: number;
  heading: number;
  trail: [number, number][];
}

const TICK_MS = 2000;
const TRAIL_MAX = 150; // ~5 min at 2s tick
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class FleetSimulator implements TelematicsProvider {
  readonly name = 'FBV Telematics SIM';
  private states = new Map<string, SimState>();
  private subs = new Set<(p: Map<string, LivePosition>) => void>();
  private eventSubs = new Set<(e: TelematicsEvent) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(configs: SimVehicleConfig[]) {
    for (const cfg of configs) {
      const c = prepareCorridor(cfg.corridorId);
      const fixed = cfg.mode === 'parked' || cfg.mode === 'idling';
      const pt = fixed && cfg.parkedAt
        ? { lat: cfg.parkedAt[0], lng: cfg.parkedAt[1], heading: rnd(0, 360) }
        : pointAt(c, cfg.startKm);
      const offline = cfg.mode === 'offline';
      this.states.set(cfg.vehicleId, {
        cfg, km: cfg.startKm, dir: 1,
        speedKmh: 0, targetSpeed: 0,
        mode: offline ? 'offline' : cfg.mode === 'parked' ? 'dwell' : cfg.mode === 'idling' ? 'idle' : 'moving',
        ticksLeft: offline ? 0 : fixed ? 999999 : 0,
        lat: pt.lat, lng: pt.lng, heading: pt.heading,
        trail: [[pt.lat, pt.lng]],
      });
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  isRunning() { return this.timer !== null; }

  subscribe(cb: (p: Map<string, LivePosition>) => void) {
    this.subs.add(cb);
    cb(this.snapshot());
    return () => this.subs.delete(cb);
  }
  onEvent(cb: (e: TelematicsEvent) => void) {
    this.eventSubs.add(cb);
    return () => this.eventSubs.delete(cb);
  }
  trail(vehicleId: string): [number, number][] {
    return this.states.get(vehicleId)?.trail ?? [];
  }
  trails(): Map<string, [number, number][]> {
    const m = new Map<string, [number, number][]>();
    this.states.forEach((s, id) => m.set(id, s.trail));
    return m;
  }

  private emit(e: TelematicsEvent) {
    this.eventSubs.forEach((cb) => cb(e));
  }

  private tick() {
    const now = Date.now();
    this.states.forEach((s) => {
      if (s.mode === 'offline') return;
      const c = prepareCorridor(s.cfg.corridorId);

      if (s.mode === 'dwell' || s.mode === 'idle') {
        s.speedKmh = 0;
        if (s.ticksLeft !== 999999 && --s.ticksLeft <= 0) {
          s.mode = 'moving';
          s.targetSpeed = rnd(c.speed[0], c.speed[1]);
        }
      } else {
        // accelerate/decelerate toward target speed
        s.speedKmh += (s.targetSpeed - s.speedKmh) * 0.15 + rnd(-2, 2);
        s.speedKmh = Math.max(4, Math.min(s.speedKmh, c.speed[1] + 8));
        const kmThisTick = (s.speedKmh / 3600) * (TICK_MS / 1000);
        s.km += kmThisTick * s.dir;

        // bounce at corridor ends -> dwell stop then return
        if (s.km >= c.lengthKm || s.km <= 0) {
          s.dir = s.dir === 1 ? -1 : 1;
          s.km = Math.max(0, Math.min(s.km, c.lengthKm));
          s.mode = 'dwell';
          s.ticksLeft = Math.round(rnd(30, 120)); // 1–4 min rest stop
          this.emit({ kind: 'trip_completed', vehicleId: s.cfg.vehicleId, at: new Date(now).toISOString(), location: c.name });
        }
        // random dwell / idle segments
        if (Math.random() < 0.004) {
          s.mode = 'dwell'; s.ticksLeft = Math.round(rnd(15, 90));
        } else if (Math.random() < 0.006) {
          s.mode = 'idle'; s.ticksLeft = Math.round(rnd(8, 45));
        }
        // harsh events
        if (Math.random() < 0.0035) {
          const kinds = ['harsh_braking', 'harsh_acceleration', 'harsh_cornering'] as const;
          this.emit({
            kind: kinds[Math.floor(Math.random() * kinds.length)],
            vehicleId: s.cfg.vehicleId,
            at: new Date(now).toISOString(),
            location: c.name,
            speedKmh: Math.round(s.speedKmh),
          });
        }
        if (!c.city && Math.random() < 0.0025 && s.speedKmh > 82) {
          this.emit({
            kind: 'speeding', vehicleId: s.cfg.vehicleId,
            at: new Date(now).toISOString(), location: c.name,
            speedKmh: Math.round(s.speedKmh),
          });
        }
        const pt = pointAt(c, s.km);
        s.lat = pt.lat; s.lng = pt.lng; s.heading = pt.heading;
        if (s.dir === -1) s.heading = (s.heading + 180) % 360;
        s.trail.push([s.lat, s.lng]);
        if (s.trail.length > TRAIL_MAX) s.trail.shift();
      }
    });
    this.subs.forEach((cb) => cb(this.snapshot()));
  }

  private snapshot(): Map<string, LivePosition> {
    const m = new Map<string, LivePosition>();
    const now = Date.now();
    this.states.forEach((s, id) => {
      const status: VehicleStatus =
        s.mode === 'offline' ? 'offline'
        : s.mode === 'moving' ? 'moving'
        : s.mode === 'idle' ? 'idling' : 'stopped';
      m.set(id, {
        vehicleId: id, lat: s.lat, lng: s.lng,
        speedKmh: Math.round(s.speedKmh), heading: Math.round(s.heading),
        ignition: s.mode !== 'offline' && s.mode !== 'dwell',
        status, at: now,
      });
    });
    return m;
  }
}
