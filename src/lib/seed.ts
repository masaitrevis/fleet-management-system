// FBV FleetOS — seeded demo dataset (design.md §9, info.md seed scenario)
// Deterministic (mulberry32) so every browser seeds identically.

import type {
  AlertRec, AppUser, Asset, AuditEntry, CompanyProfile, DocumentRec, Driver,
  FuelLog, Geofence, GeofenceEvent, Inspection, Job, MaintenanceSchedule, Part,
  RewardStanding, SafetyEvent, Settings, Shift, Trip, Vehicle, Vendor, WorkOrder,
} from './types';
import type { FleetCollections } from './types';
import type { SimVehicleConfig } from './telematics';

/** The demo universe's "today". */
export const TODAY = '2026-07-28';
export const HISTORY_DAYS = 60;

/* seeded RNG */
function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260728);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
const ri = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
const rf = (a: number, b: number, dp = 1) => Number((a + rng() * (b - a)).toFixed(dp));

function isoDaysAgo(days: number, h = 8, m = 0): string {
  const d = new Date(`${TODAY}T00:00:00+03:00`);
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(h - 3, m, 0, 0); // store EAT wall-clock as UTC-shifted
  return d.toISOString();
}
function dateDaysAgo(days: number): string {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
function dateInDays(days: number): string {
  return dateDaysAgo(-days);
}

/* ------------------------------------------------------------------ */
/* Vehicles (14) & drivers (10)                                        */
/* ------------------------------------------------------------------ */

const VEHICLE_SPECS: Array<[string, string, number, Vehicle['type'], number, 'diesel' | 'petrol', number]> = [
  // plate, model, year, type, tankL, fuel, purchaseCostKes
  ['KDJ 123A', 'Isuzu FRR Box Truck', 2022, 'truck', 200, 'diesel', 6850000],
  ['KDJ 457B', 'Toyota Hilux', 2023, 'pickup', 80, 'diesel', 5200000],
  ['KDK 208C', 'Mitsubishi Canter', 2021, 'truck', 140, 'diesel', 5950000],
  ['KDK 311D', 'Toyota Hiace', 2020, 'van', 70, 'diesel', 4150000],
  ['KDK 519E', 'Isuzu NQR', 2022, 'truck', 160, 'diesel', 6400000],
  ['KDL 102F', 'Toyota Corolla', 2019, 'car', 50, 'petrol', 1950000],
  ['KDL 233G', 'Ford Ranger', 2023, 'pickup', 80, 'diesel', 5750000],
  ['KDL 348H', 'Isuzu FTR', 2021, 'truck', 200, 'diesel', 7200000],
  ['KDJ 672J', 'Nissan NP300', 2018, 'pickup', 75, 'diesel', 2650000],
  ['KDK 784K', 'Toyota Coaster', 2022, 'bus', 95, 'diesel', 8300000],
  ['KDL 905L', 'Hino 500', 2020, 'truck', 200, 'diesel', 7800000],
  ['KDJ 816M', 'Suzuki Carry Van', 2017, 'van', 40, 'petrol', 1450000],
  ['KDK 940N', 'Toyota Land Cruiser', 2023, 'pickup', 90, 'diesel', 11500000],
  ['KDL 567P', 'Mazda BT-50', 2021, 'pickup', 80, 'diesel', 4350000],
];

const DRIVER_NAMES = [
  'David Mwangi', 'Grace Wanjiku', 'Peter Otieno', 'Mary Akinyi', 'John Kamau',
  'Susan Njeri', 'James Kiprop', 'Faith Chebet', 'Daniel Ouma', 'Esther Muthoni',
];

/** Vehicle → simulator wiring. Modes mirror dashboard.md demo spread:
 *  6 moving (A109 ×3, A2 ×2, city ×1) · 3 idling · 3 stopped · 2 offline */
export const SIM_CONFIGS: SimVehicleConfig[] = [
  { vehicleId: 'veh-01', corridorId: 'a109', startKm: 40, mode: 'shuttle' },   // KDJ 123A
  { vehicleId: 'veh-05', corridorId: 'a109', startKm: 180, mode: 'shuttle' },  // KDK 519E
  { vehicleId: 'veh-08', corridorId: 'a109', startKm: 330, mode: 'shuttle' },  // KDL 348H
  { vehicleId: 'veh-03', corridorId: 'a2', startKm: 28, mode: 'shuttle' },     // KDK 208C
  { vehicleId: 'veh-07', corridorId: 'a2', startKm: 8, mode: 'shuttle' },      // KDL 233G
  { vehicleId: 'veh-02', corridorId: 'city-industrial', startKm: 2, mode: 'shuttle' }, // KDJ 457B
  { vehicleId: 'veh-04', corridorId: 'city-west', startKm: 3, mode: 'idling', parkedAt: [-1.3192, 36.9278] }, // JKIA Cargo
  { vehicleId: 'veh-10', corridorId: 'city-west', startKm: 1, mode: 'idling', parkedAt: [-1.2635, 36.8029] }, // Westlands Hub
  { vehicleId: 'veh-14', corridorId: 'a2', startKm: 34, mode: 'idling', parkedAt: [-1.1467, 36.9600] },      // Thika Rd Customer
  { vehicleId: 'veh-09', corridorId: 'city-industrial', startKm: 2, mode: 'parked', parkedAt: [-1.3031, 36.8526] }, // Depot
  { vehicleId: 'veh-13', corridorId: 'a104', startKm: 155, mode: 'parked', parkedAt: [-0.3031, 36.0800] },   // Nakuru Depot
  { vehicleId: 'veh-06', corridorId: 'a109', startKm: 12, mode: 'parked', parkedAt: [-1.3320, 36.8980] },    // Mombasa Rd Yard
  { vehicleId: 'veh-11', corridorId: 'a109', startKm: 470, mode: 'offline', parkedAt: [-4.0620, 39.6570] },  // KDL 905L — Mombasa Port
  { vehicleId: 'veh-12', corridorId: 'a104', startKm: 0, mode: 'offline', parkedAt: [-0.0917, 34.7680] },    // KDJ 816M — Kisumu
];

const STATUS_BY_MODE: Record<string, Vehicle['status']> = {
  shuttle: 'moving', idling: 'idling', parked: 'stopped', offline: 'offline',
};

export function seedVehicles(): Vehicle[] {
  return VEHICLE_SPECS.map(([plate, model, year, type, tank, fuelType, cost], i) => {
    const id = `veh-${String(i + 1).padStart(2, '0')}`;
    const cfg = SIM_CONFIGS.find((c) => c.vehicleId === id)!;
    const make = model.split(' ')[0];
    const odo = ri(22000, 168000);
    return {
      id, plate, type, make, model, year,
      status: STATUS_BY_MODE[cfg.mode],
      tripStatus: id === 'veh-12' ? 'maintenance' : 'active',
      odometerKm: odo,
      engineHours: Math.round(odo / rf(28, 42)),
      fuelLevelPct: ri(24, 92),
      tankCapacityL: tank,
      fuelType,
      purchaseCostKes: cost,
      assignedDriverId: i < 10 ? `drv-${String(i + 1).padStart(2, '0')}` : null,
      depot: 'FBV Depot — Industrial Area',
      simRoute: cfg.corridorId,
      homeLat: cfg.parkedAt?.[0] ?? -1.3031,
      homeLng: cfg.parkedAt?.[1] ?? 36.8526,
      lastServiceKm: odo - ri(1200, 8800),
      createdAt: `${year}-0${ri(1, 9)}-1${ri(0, 8)}`,
    };
  });
}

export function seedDrivers(): Driver[] {
  return DRIVER_NAMES.map((name, i) => {
    const id = `drv-${String(i + 1).padStart(2, '0')}`;
    return {
      id, name,
      phone: `+254 7${ri(10, 99)} ${ri(100, 999)} ${ri(100, 999)}`,
      licenseNo: `DL-KE-${882114 + i * 7331}`,
      licenseExpiry: i === 3 ? dateInDays(24) : dateInDays(ri(120, 720)),
      psvExpiry: i === 6 ? dateInDays(58) : dateInDays(ri(90, 600)),
      safetyScore: rf(58, 98),
      status: i < 7 ? 'driving' : i === 7 ? 'off-duty' : i === 8 ? 'driving' : 'on-leave',
      hiredAt: `${ri(2017, 2024)}-0${ri(1, 9)}-0${ri(1, 9)}`,
      rewardPoints: ri(120, 940),
      badges: i === 0 ? ['Safe July', 'Fuel Miser', '5-Star'] : i === 1 ? ['Safe July'] : [],
    };
  });
}

/* ------------------------------------------------------------------ */
/* Geofences (8)                                                       */
/* ------------------------------------------------------------------ */

export function seedGeofences(): Geofence[] {
  const mk = (id: string, name: string, lat: number, lng: number, radiusM: number): Geofence => ({
    id, name, kind: 'circle', center: { lat, lng }, radiusM,
    rules: { alertOnEnter: false, alertOnExit: true, alertOnDwellMin: null },
    createdAt: '2026-05-29T08:00:00.000Z',
  });
  return [
    mk('gf-01', 'FBV Depot', -1.3031, 36.8526, 400),
    mk('gf-02', 'Mombasa Rd Yard', -1.3320, 36.8980, 300),
    mk('gf-03', 'JKIA Cargo', -1.3192, 36.9278, 500),
    mk('gf-04', 'Thika Rd Customer (Ruiru)', -1.1467, 36.9600, 350),
    {
      id: 'gf-05', name: 'Westlands Hub', kind: 'polygon',
      polygon: [
        { lat: -1.2580, lng: 36.7980 }, { lat: -1.2580, lng: 36.8090 },
        { lat: -1.2690, lng: 36.8090 }, { lat: -1.2690, lng: 36.7980 },
      ],
      rules: { alertOnEnter: true, alertOnExit: true, alertOnDwellMin: 120 },
      createdAt: '2026-05-29T08:00:00.000Z',
    },
    mk('gf-06', 'Mombasa Port', -4.0620, 39.6570, 600),
    mk('gf-07', 'Nakuru Depot', -0.3031, 36.0800, 400),
    mk('gf-08', 'Kisumu Depot', -0.0917, 34.7680, 400),
  ];
}

/* ------------------------------------------------------------------ */
/* 60 days of history: trips, fuel, safety, inspections, shifts        */
/* ------------------------------------------------------------------ */

const PLACES: Record<string, string[]> = {
  a109: ['Mombasa Rd, near Cabanas', 'Athi River', 'Machakos Junction', 'Kibwezi', 'Voi', 'Mariakani', 'Mombasa Port'],
  a104: ['Westlands', 'Limuru', 'Naivasha', 'Gilgil', 'Nakuru Depot'],
  a2: ['Kasarani', 'Ruiru', 'Juja', 'Thika'],
  'city-west': ['CBD', 'Westlands', 'Parklands'],
  'city-industrial': ['Industrial Area', 'South B', 'Enterprise Rd'],
};

export function seedTrips(vehicles: Vehicle[]): Trip[] {
  const trips: Trip[] = [];
  let n = 0;
  vehicles.forEach((v, vi) => {
    const perWeek = v.simRoute.startsWith('city') ? ri(8, 14) : ri(3, 6);
    const total = Math.round((perWeek / 7) * HISTORY_DAYS);
    for (let i = 0; i < total; i++) {
      const day = ri(1, HISTORY_DAYS);
      const longHaul = v.simRoute === 'a109' || v.simRoute === 'a104';
      const dist = v.simRoute.startsWith('city') ? ri(12, 64) : longHaul ? ri(120, 490) : ri(38, 92);
      const dur = Math.round(dist / rf(0.55, 0.95, 2) * 1.0) + ri(10, 60);
      const startH = ri(5, 16);
      const places = PLACES[v.simRoute];
      trips.push({
        id: `trp-${String(++n).padStart(5, '0')}`,
        vehicleId: v.id,
        driverId: v.assignedDriverId ?? `drv-${String((vi % 10) + 1).padStart(2, '0')}`,
        startAt: isoDaysAgo(day, startH, ri(0, 59)),
        endAt: isoDaysAgo(day, startH + Math.floor(dur / 60), (dur % 60)),
        from: pick(places), to: pick(places),
        distanceKm: dist, durationMin: dur, idleMin: ri(4, 52),
        maxSpeedKmh: longHaul ? ri(88, 112) : ri(58, 96),
        classification: rng() < 0.88 ? 'business' : rng() < 0.5 ? 'private' : 'unclassified',
        corridor: v.simRoute,
      });
    }
  });
  return trips.sort((a, b) => b.startAt.localeCompare(a.startAt));
}

const STATIONS = ['Total Energies Mombasa Rd', 'Shell Athi River', 'Rubis Thika Rd', 'Ola Energy Nakuru', 'Total Westlands', 'Shell Voi', 'Rubis Industrial Area'];

export function seedFuelLogs(vehicles: Vehicle[]): FuelLog[] {
  const logs: FuelLog[] = [];
  let n = 0;
  vehicles.forEach((v) => {
    const count = ri(8, 16);
    let odo = v.odometerKm - ri(2000, 9000);
    for (let i = 0; i < count; i++) {
      const day = Math.round((i + 1) * (HISTORY_DAYS / count)) + ri(-1, 1);
      const price = v.fuelType === 'diesel' ? rf(184, 196, 2) : rf(198, 211, 2);
      const litres = rf(v.tankCapacityL * 0.35, v.tankCapacityL * 0.9);
      odo += ri(220, 980);
      const anomaly: FuelLog['anomaly'] =
        rng() < 0.035 ? pick(['location_mismatch', 'volume_exceeds_tank', 'consumption_spike'] as const) : 'none';
      const station = pick(STATIONS);
      logs.push({
        id: `fuel-${String(++n).padStart(5, '0')}`,
        vehicleId: v.id, driverId: v.assignedDriverId ?? 'drv-01',
        station, lat: -1.30 + rf(-0.2, 0.2, 4), lng: 36.85 + rf(-0.2, 0.2, 4),
        litres: anomaly === 'volume_exceeds_tank' ? rf(v.tankCapacityL * 1.05, v.tankCapacityL * 1.3) : litres,
        pricePerLKes: price, totalKes: Math.round(litres * price),
        odometerKm: odo, at: isoDaysAgo(Math.max(1, day), ri(6, 19), ri(0, 59)),
        anomaly,
      });
    }
  });
  return logs.sort((a, b) => b.at.localeCompare(a.at));
}

const SAFETY_TYPES: SafetyEvent['type'][] = ['harsh_braking', 'harsh_acceleration', 'harsh_cornering', 'speeding', 'seatbelt', 'distraction'];
const DASHCAMS = ['/dashcam-01.jpg', '/dashcam-02.jpg', '/dashcam-03.jpg', '/dashcam-04.jpg'];

export function seedSafetyEvents(vehicles: Vehicle[]): SafetyEvent[] {
  const events: SafetyEvent[] = [];
  let n = 0;
  vehicles.forEach((v) => {
    const count = ri(6, 16);
    for (let i = 0; i < count; i++) {
      const day = ri(0, HISTORY_DAYS);
      const type = pick(SAFETY_TYPES);
      events.push({
        id: `sev-${String(++n).padStart(5, '0')}`,
        type, severity: type === 'speeding' || type === 'distraction' ? pick(['major', 'critical'] as const) : pick(['minor', 'major'] as const),
        vehicleId: v.id, driverId: v.assignedDriverId ?? 'drv-01',
        at: isoDaysAgo(day, ri(6, 20), ri(0, 59)),
        location: pick(PLACES[v.simRoute]),
        speedKmh: type === 'speeding' ? ri(86, 118) : ri(40, 90),
        coachingStatus: day < 14 ? pick(['coached', 'acknowledged', 'reviewed'] as const) : pick(['new', 'reviewed'] as const),
        dashcamImage: rng() < 0.45 ? pick(DASHCAMS) : undefined,
      });
    }
  });
  return events.sort((a, b) => b.at.localeCompare(a.at));
}

const DVIR_LABELS = ['Tyres & wheels', 'Brakes', 'Lights & indicators', 'Mirrors & glass', 'Fluid leaks', 'Horn', 'Seatbelts', 'Body damage', 'Fire extinguisher', 'Reflectors & triangles'];

export function seedInspections(vehicles: Vehicle[]): Inspection[] {
  const out: Inspection[] = [];
  let n = 0;
  vehicles.slice(0, 10).forEach((v) => {
    for (let i = 0; i < ri(4, 8); i++) {
      const day = ri(0, 30);
      const defective = rng() < 0.22;
      const items = DVIR_LABELS.map((label, k) => {
        const bad = defective && k === ri(0, 3);
        return {
          key: `item-${k}`, label,
          result: (bad ? 'defect' : rng() < 0.06 ? 'na' : 'ok') as 'ok' | 'defect' | 'na',
          note: bad ? pick(['Worn tread front-left', 'Cracked mirror', 'Slow air build-up', 'Bumper dent']) : undefined,
        };
      });
      const defects = items.filter((it) => it.result === 'defect').length;
      out.push({
        id: `dvir-${String(++n).padStart(4, '0')}`,
        vehicleId: v.id, driverId: v.assignedDriverId ?? 'drv-01',
        kind: rng() < 0.7 ? 'pre-trip' : 'post-trip',
        at: isoDaysAgo(day, ri(5, 8), ri(0, 59)),
        odometerKm: v.odometerKm - day * ri(80, 420),
        items, result: defects > 0 ? 'fail' : 'pass', defectsCount: defects,
      });
    }
  });
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export function seedShifts(drivers: Driver[], vehicles: Vehicle[]): Shift[] {
  const out: Shift[] = [];
  let n = 0;
  drivers.forEach((d, i) => {
    for (let day = 1; day <= 21; day += ri(1, 2)) {
      if (d.status === 'on-leave' && day < 10) continue;
      const drivingMin = ri(260, 620);
      out.push({
        id: `shf-${String(++n).padStart(4, '0')}`,
        driverId: d.id,
        vehicleId: vehicles[i]?.id ?? null,
        startAt: isoDaysAgo(day, ri(5, 7), ri(0, 59)),
        endAt: isoDaysAgo(day, Math.min(22, 6 + Math.round(drivingMin / 60) + 1), ri(0, 59)),
        drivingMin,
        restWarning: drivingMin > 540,
      });
    }
  });
  return out.sort((a, b) => b.startAt.localeCompare(a.startAt));
}

/* ------------------------------------------------------------------ */
/* Documents — 6 expiring within 90 days                               */
/* ------------------------------------------------------------------ */

export function seedDocuments(vehicles: Vehicle[], drivers: Driver[]): DocumentRec[] {
  const docs: DocumentRec[] = [];
  let n = 0;
  const add = (entityType: 'vehicle' | 'driver', entityId: string, docType: string, expiresAt: string) => {
    docs.push({
      id: `doc-${String(++n).padStart(3, '0')}`, entityType, entityId, docType,
      number: `${docType.slice(0, 3).toUpperCase()}-KE-${ri(100000, 999999)}`,
      issuedAt: dateDaysAgo(ri(200, 360)), expiresAt,
    });
  };
  // 6 expiring (90/60/30 radar)
  add('vehicle', 'veh-01', 'Insurance', dateInDays(88));
  add('vehicle', 'veh-03', 'Inspection Cert', dateInDays(61));
  add('vehicle', 'veh-05', 'Insurance', dateInDays(57));
  add('driver', 'drv-04', 'Driving Licence', dateInDays(24));
  add('driver', 'drv-07', 'PSV Badge', dateInDays(58));
  add('vehicle', 'veh-08', 'Road Service Licence', dateInDays(12));
  // healthy remainder
  vehicles.forEach((v) => {
    add('vehicle', v.id, 'Insurance', dateInDays(ri(120, 340)));
    if (v.type === 'truck' || v.type === 'bus') add('vehicle', v.id, 'Inspection Cert', dateInDays(ri(100, 300)));
  });
  drivers.forEach((d) => {
    add('driver', d.id, 'Driving Licence', dateInDays(ri(140, 700)));
  });
  return docs;
}

/* ------------------------------------------------------------------ */
/* Maintenance — 5 open WOs, schedules, parts, vendors                 */
/* ------------------------------------------------------------------ */

export function seedVendors(): Vendor[] {
  return [
    { id: 'ven-01', name: 'Isuzu East Africa Service', specialty: 'Isuzu trucks — authorised', phone: '+254 20 654 3210', location: 'Mombasa Rd', preferred: true },
    { id: 'ven-02', name: 'Autocraft Garage', specialty: 'General repairs & bodywork', phone: '+254 722 456 789', location: 'Industrial Area', preferred: true },
    { id: 'ven-03', name: 'Tyre Masters Kenya', specialty: 'Tyres, alignment, balancing', phone: '+254 733 221 100', location: 'Likoni Rd', preferred: false },
    { id: 'ven-04', name: 'Nakuru Auto Clinic', specialty: 'Upcountry breakdown support', phone: '+254 51 221 4455', location: 'Nakuru', preferred: false },
  ];
}

export function seedWorkOrders(): WorkOrder[] {
  const mk = (
    n: number, vehicleId: string, source: WorkOrder['source'], status: WorkOrder['status'],
    priority: WorkOrder['priority'], title: string, items: [string, number, number][],
    labor: number, vendorId: string | null, openedDaysAgo: number, done = false,
  ): WorkOrder => ({
    id: `wo-${String(n).padStart(3, '0')}`,
    number: `FBV-WO-${String(118 + n).padStart(6, '0')}`,
    vehicleId, source, status, priority, title,
    items: items.map(([description, qty, unitCostKes]) => ({ description, qty, unitCostKes })),
    laborCostKes: labor, vendorId,
    openedAt: isoDaysAgo(openedDaysAgo, 9), dueAt: done ? null : dateInDays(ri(2, 14)),
    completedAt: done ? isoDaysAgo(Math.max(0, openedDaysAgo - ri(1, 4)), 16) : null,
  });
  return [
    mk(1, 'veh-03', 'schedule', 'in-progress', 'high', 'Service B — oil, filters, brakes', [['Engine oil 15W-40 (L)', 18, 980], ['Oil filter', 1, 2400], ['Fuel filter', 1, 3100], ['Brake pads front (set)', 1, 8500]], 12000, 'ven-02', 3),
    mk(2, 'veh-12', 'dvir', 'open', 'high', 'DVIR defect — brake imbalance', [['Brake shoes rear (set)', 1, 6200]], 8500, 'ven-04', 1),
    mk(3, 'veh-01', 'dtc', 'open', 'medium', 'DTC P0401 — EGR flow insufficient', [['EGR valve cleaning kit', 1, 1500]], 6000, 'ven-01', 2),
    mk(4, 'veh-09', 'manual', 'approved', 'low', 'Tyre rotation + alignment', [['Wheel alignment', 1, 3500]], 2500, 'ven-03', 6),
    mk(5, 'veh-06', 'schedule', 'open', 'medium', '90,000 km service', [['Air filter', 1, 2800], ['Cabin filter', 1, 1600]], 7500, 'ven-02', 4),
    mk(6, 'veh-05', 'schedule', 'done', 'medium', 'Service A — oil & inspection', [['Engine oil 15W-40 (L)', 14, 980], ['Oil filter', 1, 2200]], 8000, 'ven-01', 18, true),
    mk(7, 'veh-08', 'manual', 'done', 'medium', 'Clutch replacement', [['Clutch kit', 1, 38500]], 22000, 'ven-02', 26, true),
    mk(8, 'veh-02', 'dvir', 'done', 'low', 'Cracked wing mirror', [['Wing mirror LH', 1, 4800]], 1200, 'ven-02', 33, true),
  ];
}

export function seedSchedules(vehicles: Vehicle[]): MaintenanceSchedule[] {
  const out: MaintenanceSchedule[] = [];
  let n = 0;
  vehicles.filter((v) => v.tripStatus === 'active').forEach((v, i) => {
    const intervalKm = v.type === 'truck' ? 10000 : 5000;
    const nextDueKm = v.lastServiceKm + intervalKm;
    out.push({
      id: `sch-${String(++n).padStart(3, '0')}`,
      vehicleId: v.id, name: i % 3 === 0 ? 'Service B (major)' : 'Service A (minor)',
      type: 'odometer', intervalKm,
      lastDoneAt: dateDaysAgo(ri(20, 90)), lastDoneKm: v.lastServiceKm,
      nextDueKm,
    });
  });
  vehicles.slice(0, 5).forEach((v) => {
    out.push({
      id: `sch-${String(++n).padStart(3, '0')}`,
      vehicleId: v.id, name: 'Annual inspection', type: 'calendar', intervalDays: 365,
      lastDoneAt: dateDaysAgo(ri(200, 340)), lastDoneKm: v.lastServiceKm,
      nextDueAt: dateInDays(ri(25, 165)),
    });
  });
  return out;
}

export function seedParts(): Part[] {
  const rows: [string, string, number, number, number][] = [
    ['FLT-OIL-FRR', 'Oil filter — Isuzu FRR/FTR', 12, 6, 2400],
    ['FLT-FUEL-CANT', 'Fuel filter — Canter', 8, 4, 3100],
    ['OIL-15W40-20L', 'Engine oil 15W-40 (20L)', 15, 8, 19600],
    ['BRK-PAD-HLX', 'Brake pads — Hilux/Ranger', 6, 4, 8500],
    ['TYR-225-75R15', 'Tyre 225/75 R15', 10, 6, 18500],
    ['BAT-12V-100AH', 'Battery 12V 100Ah', 5, 3, 14500],
    ['BLB-H4', 'Headlamp bulb H4', 24, 12, 450],
    ['WPR-26', 'Wiper blade 26"', 18, 8, 900],
  ];
  return rows.map(([sku, name, qty, reorderLevel, unitCostKes], i) => ({
    id: `part-${String(i + 1).padStart(2, '0')}`, sku, name, qty, reorderLevel, unitCostKes,
  }));
}

/* ------------------------------------------------------------------ */
/* Dispatch — 4 active jobs (+ history)                                */
/* ------------------------------------------------------------------ */

export function seedJobs(vehicles: Vehicle[]): Job[] {
  const stop = (id: string, label: string, address: string, lat: number, lng: number): Job['stops'][number] =>
    ({ id, label, address, lat, lng });
  const jobs: Job[] = [
    {
      id: 'job-01', number: 'FBV-JOB-000455', customer: 'Naivas Supermarkets',
      vehicleId: vehicles[0].id, driverId: 'drv-01', status: 'en-route',
      stops: [
        { ...stop('s1', 'Pickup — FBV Depot', 'Likoni Rd, Industrial Area', -1.3031, 36.8526), arrivedAt: isoDaysAgo(0, 6, 40), completedAt: isoDaysAgo(0, 7, 15) },
        stop('s2', 'Drop — Naivas Mombasa', 'Nyali, Mombasa', -4.0180, 39.7100),
      ],
      createdAt: isoDaysAgo(1, 15), scheduledAt: isoDaysAgo(0, 6),
    },
    {
      id: 'job-02', number: 'FBV-JOB-000456', customer: 'Bidco Africa',
      vehicleId: vehicles[2].id, driverId: 'drv-03', status: 'assigned',
      stops: [
        stop('s1', 'Pickup — Bidco Thika', 'Thika Industrial Park', -1.0450, 37.0600),
        stop('s2', 'Drop — Bidco Depot Ruiru', 'Ruiru', -1.1467, 36.9600),
      ],
      createdAt: isoDaysAgo(0, 10), scheduledAt: isoDaysAgo(0, 14),
    },
    {
      id: 'job-03', number: 'FBV-JOB-000457', customer: 'Unga Group',
      vehicleId: vehicles[4].id, driverId: 'drv-05', status: 'arrived',
      stops: [
        { ...stop('s1', 'Pickup — Unga Nakuru', 'Nakuru', -0.3031, 36.0800), arrivedAt: isoDaysAgo(0, 8, 5), completedAt: isoDaysAgo(0, 8, 50) },
        stop('s2', 'Drop — Unga Eldoret', 'Eldoret', 0.5143, 35.2698),
      ],
      createdAt: isoDaysAgo(2, 9), scheduledAt: isoDaysAgo(0, 7),
    },
    {
      id: 'job-04', number: 'FBV-JOB-000458', customer: 'Java House',
      vehicleId: vehicles[6].id, driverId: 'drv-07', status: 'en-route',
      stops: [
        { ...stop('s1', 'Pickup — Java Roastery', 'Ruiru', -1.1467, 36.9600), arrivedAt: isoDaysAgo(0, 9, 10), completedAt: isoDaysAgo(0, 9, 40) },
        stop('s2', 'Drop — Java Westlands', 'Westlands', -1.2635, 36.8029),
        stop('s3', 'Drop — Java Junction', 'Ngong Rd', -1.2980, 36.7620),
      ],
      createdAt: isoDaysAgo(1, 11), scheduledAt: isoDaysAgo(0, 9),
    },
    {
      id: 'job-05', number: 'FBV-JOB-000451', customer: 'Mombasa Cement',
      vehicleId: vehicles[7].id, driverId: 'drv-08', status: 'delivered',
      stops: [
        { ...stop('s1', 'Pickup — Athi River', 'Athi River', -1.4563, 36.9783), arrivedAt: isoDaysAgo(2, 6, 30), completedAt: isoDaysAgo(2, 7, 20) },
        { ...stop('s2', 'Drop — Mombasa', 'Changamwe', -4.0200, 39.6300), arrivedAt: isoDaysAgo(2, 15, 40), completedAt: isoDaysAgo(2, 16, 20) },
      ],
      createdAt: isoDaysAgo(3, 14), scheduledAt: isoDaysAgo(2, 6),
      pod: { signedBy: 'R. Salim', at: isoDaysAgo(2, 16, 20), photo: '/pod-photo-01.jpg', notes: '40 bags received in good order' },
    },
    {
      id: 'job-06', number: 'FBV-JOB-000449', customer: 'Car & General',
      vehicleId: vehicles[12].id, driverId: 'drv-03', status: 'delivered',
      stops: [
        { ...stop('s1', 'Pickup — C&G Nairobi', 'Industrial Area', -1.3050, 36.8480), arrivedAt: isoDaysAgo(5, 8), completedAt: isoDaysAgo(5, 9) },
        { ...stop('s2', 'Drop — Nakuru warehouse', 'Nakuru', -0.2900, 36.0650), arrivedAt: isoDaysAgo(5, 13), completedAt: isoDaysAgo(5, 14) },
      ],
      createdAt: isoDaysAgo(6, 10), scheduledAt: isoDaysAgo(5, 8),
      pod: { signedBy: 'P. Njoroge', at: isoDaysAgo(5, 14, 5), photo: '/pod-photo-02.jpg' },
    },
  ];
  return jobs;
}

/* ------------------------------------------------------------------ */
/* Assets, alerts, users, audit, rewards, geofence events              */
/* ------------------------------------------------------------------ */

export function seedAssets(vehicles: Vehicle[]): Asset[] {
  return [
    { id: 'ast-01', type: 'trailer', name: 'Flatbed Trailer 12m', tag: 'ZE 4412', status: 'assigned', assignedVehicleId: vehicles[7].id, utilizationPct: 78, purchaseCostKes: 1850000 },
    { id: 'ast-02', type: 'trailer', name: 'Box Trailer 8m', tag: 'ZE 3887', status: 'available', assignedVehicleId: null, utilizationPct: 41, purchaseCostKes: 1420000 },
    { id: 'ast-03', type: 'generator', name: 'Generator 60kVA', tag: 'GEN-060', status: 'assigned', assignedVehicleId: vehicles[9].id, utilizationPct: 64, purchaseCostKes: 980000 },
    { id: 'ast-04', type: 'generator', name: 'Generator 20kVA', tag: 'GEN-020', status: 'maintenance', assignedVehicleId: null, utilizationPct: 22, purchaseCostKes: 420000 },
    { id: 'ast-05', type: 'equipment', name: 'Forklift 2.5T', tag: 'EQP-FL25', status: 'available', assignedVehicleId: null, utilizationPct: 55, purchaseCostKes: 2350000 },
    { id: 'ast-06', type: 'equipment', name: 'Mobile Cold Room', tag: 'EQP-CR04', status: 'assigned', assignedVehicleId: vehicles[3].id, utilizationPct: 71, purchaseCostKes: 1150000 },
  ];
}

export function seedAlerts(vehicles: Vehicle[]): AlertRec[] {
  const v = (i: number) => ({ kind: 'vehicle' as const, id: vehicles[i].id, label: vehicles[i].plate });
  return [
    { id: 'al-001', type: 'speeding', severity: 'critical', message: 'Speeding 96 km/h in 80 zone — KDK 208C, Thika Rd', entityRef: v(2), at: isoDaysAgo(0, 10, 41), read: false, acknowledged: false },
    { id: 'al-002', type: 'harsh_event', severity: 'major', message: 'Harsh braking — KDJ 123A, Mombasa Hwy near Kibwezi', entityRef: v(0), at: isoDaysAgo(0, 10, 12), read: false, acknowledged: false },
    { id: 'al-003', type: 'fuel_anomaly', severity: 'major', message: 'Fuel anomaly — 96L logged vs 80L tank (KDL 233G)', entityRef: v(6), at: isoDaysAgo(0, 8, 55), read: false, acknowledged: false },
    { id: 'al-004', type: 'document_expiry', severity: 'major', message: 'Road Service Licence expires in 12 days — KDL 348H', entityRef: v(7), at: isoDaysAgo(0, 7, 30), read: true, acknowledged: false },
    { id: 'al-005', type: 'device_offline', severity: 'critical', message: 'Device offline 26h — KDL 905L (last: Mombasa Port)', entityRef: v(10), at: isoDaysAgo(1, 5, 22), read: false, acknowledged: false },
    { id: 'al-006', type: 'maintenance_due', severity: 'minor', message: 'Service due in 480 km — KDK 208C', entityRef: v(2), at: isoDaysAgo(1, 9, 0), read: true, acknowledged: true },
    { id: 'al-007', type: 'geofence', severity: 'info', message: 'Geofence exit — FBV Depot (KDJ 123A) 09:12', entityRef: v(0), at: isoDaysAgo(0, 9, 12), read: true, acknowledged: true },
    { id: 'al-008', type: 'shift_violation', severity: 'critical', message: 'Driving time 9h12m exceeded — James Kiprop', entityRef: { kind: 'driver', id: 'drv-07', label: 'James Kiprop' }, at: isoDaysAgo(1, 18, 45), read: true, acknowledged: false },
    { id: 'al-009', type: 'dtc', severity: 'minor', message: 'DTC P0401 EGR flow — KDJ 123A', entityRef: v(0), at: isoDaysAgo(2, 11, 18), read: true, acknowledged: true },
  ];
}

export function seedUsers(): AppUser[] {
  return [
    { id: 'usr-01', name: 'Admin User', email: 'admin@fbv.co.ke', role: 'Admin', active: true, lastLoginAt: isoDaysAgo(0, 7, 55) },
    { id: 'usr-02', name: 'Wanjiru Maina', email: 'fleet@fbv.co.ke', role: 'Fleet Manager', phone: '+254 722 100 200', active: true, lastLoginAt: isoDaysAgo(0, 8, 20) },
    { id: 'usr-03', name: 'Brian Kibe', email: 'dispatch@fbv.co.ke', role: 'Dispatcher', active: true, lastLoginAt: isoDaysAgo(1, 9, 5) },
    { id: 'usr-04', name: 'Kevin Onyango', email: 'mechanic@fbv.co.ke', role: 'Mechanic', active: true, lastLoginAt: isoDaysAgo(0, 6, 45) },
    { id: 'usr-05', name: 'David Mwangi', email: 'driver@fbv.co.ke', role: 'Driver', active: true, lastLoginAt: isoDaysAgo(0, 5, 30) },
    { id: 'usr-06', name: 'Auditor View', email: 'readonly@fbv.co.ke', role: 'Read-only', active: true, lastLoginAt: null },
  ];
}

export function seedAudit(): AuditEntry[] {
  const base = [
    ['usr-02', 'Wanjiru Maina', 'update', 'vehicles', 'veh-03', 'Updated odometer KDK 208C → 128,440 km'],
    ['usr-03', 'Brian Kibe', 'create', 'jobs', 'job-04', 'Created job FBV-JOB-000458 (Java House)'],
    ['usr-04', 'Kevin Onyango', 'update', 'workOrders', 'wo-001', 'WO FBV-WO-000119 → in-progress'],
    ['usr-01', 'Admin User', 'import', 'fuelLogs', 'bulk', 'Bulk-uploaded 24 fuel logs from Excel'],
    ['usr-02', 'Wanjiru Maina', 'update', 'drivers', 'drv-07', 'Coaching marked acknowledged — James Kiprop'],
    ['usr-01', 'Admin User', 'update', 'settings', 'settings', 'Speed limit threshold 90 → 100 km/h'],
    ['usr-03', 'Brian Kibe', 'create', 'geofences', 'gf-05', 'Created geofence Westlands Hub (polygon)'],
    ['usr-01', 'Admin User', 'export', 'reports', 'utilization-jun', 'Exported Utilization report (Excel)'],
  ] as const;
  return base.map(([userId, userName, action, collection, recordId, summary], i) => ({
    id: `aud-${String(i + 1).padStart(3, '0')}`,
    at: isoDaysAgo(i % 3, 8 + i, ri(0, 59)),
    userId, userName, action: action as AuditEntry['action'], collection, recordId, summary,
  }));
}

export function seedRewards(drivers: Driver[]): RewardStanding[] {
  const sorted = [...drivers].sort((a, b) => b.rewardPoints - a.rewardPoints);
  return sorted.map((d, i) => ({
    driverId: d.id, month: '2026-07', points: d.rewardPoints, rank: i + 1,
    badges: d.badges, trend: i < 3 ? 'up' : i > 7 ? 'down' : 'flat',
  }));
}

export function seedGeofenceEvents(vehicles: Vehicle[]): GeofenceEvent[] {
  const out: GeofenceEvent[] = [];
  let n = 0;
  for (let i = 0; i < 26; i++) {
    const gf = pick(['gf-01', 'gf-02', 'gf-03', 'gf-05', 'gf-06', 'gf-07']);
    const type = pick(['enter', 'exit', 'dwell'] as const);
    out.push({
      id: `gfe-${String(++n).padStart(4, '0')}`,
      geofenceId: gf, vehicleId: pick(vehicles).id, type,
      at: isoDaysAgo(ri(0, 14), ri(5, 20), ri(0, 59)),
      dwellMin: type === 'dwell' ? ri(25, 240) : undefined,
    });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/* ------------------------------------------------------------------ */
/* Top-level seed                                                      */
/* ------------------------------------------------------------------ */

export function seedCollections(): FleetCollections {
  const vehicles = seedVehicles();
  const drivers = seedDrivers();
  return {
    vehicles,
    drivers,
    geofences: seedGeofences(),
    geofenceEvents: seedGeofenceEvents(vehicles),
    trips: seedTrips(vehicles),
    safetyEvents: seedSafetyEvents(vehicles),
    inspections: seedInspections(vehicles),
    shifts: seedShifts(drivers, vehicles),
    documents: seedDocuments(vehicles, drivers),
    workOrders: seedWorkOrders(),
    schedules: seedSchedules(vehicles),
    parts: seedParts(),
    vendors: seedVendors(),
    fuelLogs: seedFuelLogs(vehicles),
    jobs: seedJobs(vehicles),
    assets: seedAssets(vehicles),
    alerts: seedAlerts(vehicles),
    users: seedUsers(),
    audit: seedAudit(),
    rewards: seedRewards(drivers),
  };
}

export function seedProfile(): CompanyProfile {
  return {
    name: 'Future Bright Ventures Ltd',
    country: 'Kenya', city: 'Nairobi',
    address: 'Likoni Rd, Industrial Area, Nairobi',
    phone: '+254 20 555 0100', email: 'ops@fbv.co.ke',
    currency: 'KES', timezone: 'Africa/Nairobi',
  };
}

export function seedSettings(): Settings {
  return {
    speedLimitKmh: 100,
    idleAlertMin: 10,
    docExpiryWarnDays: [90, 60, 30],
    fuelPriceDieselKes: 189.5,
    fuelPricePetrolKes: 204.3,
    sequences: { wo: 124, job: 459, driver: 11, vehicle: 15 },
    alertPrefs: { speeding: true, geofence: true, harsh_event: true, fuel_anomaly: true, document_expiry: true, maintenance_due: true, dtc: true, device_offline: true, shift_violation: true },
  };
}
