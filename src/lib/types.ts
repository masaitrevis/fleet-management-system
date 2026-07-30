// FBV FleetOS — entity types (design.md §9, info.md data-model sketch)
// "today" in the demo universe is 2026-07-28 (see seed.ts TODAY).

export type ID = string;

export type VehicleStatus = 'moving' | 'idling' | 'stopped' | 'offline';
export type TripStatus = 'active' | 'maintenance' | 'inactive';

export type VehicleType = 'truck' | 'van' | 'pickup' | 'car' | 'bus';

export interface Vehicle {
  id: ID;
  plate: string;                 // e.g. "KDJ 123A"
  type: VehicleType;
  make: string;
  model: string;
  year: number;
  status: VehicleStatus;
  tripStatus: TripStatus;
  odometerKm: number;
  engineHours: number;
  fuelLevelPct: number;
  tankCapacityL: number;
  fuelType: 'diesel' | 'petrol';
  purchaseCostKes: number;
  assignedDriverId: ID | null;
  depot: string;
  simRoute: string;              // corridor id from telematics
  homeLat: number;
  homeLng: number;
  lastServiceKm: number;
  createdAt: string;             // ISO
}

export interface Driver {
  id: ID;
  name: string;
  phone: string;
  licenseNo: string;             // e.g. "DL-KE-882114"
  licenseExpiry: string;         // ISO date
  psvExpiry: string;             // ISO date
  safetyScore: number;           // 0–100
  status: 'driving' | 'off-duty' | 'on-leave';
  hiredAt: string;
  rewardPoints: number;          // July 2026 standings
  badges: string[];
}

export type Severity = 'critical' | 'major' | 'minor' | 'info';

export interface Geofence {
  id: ID;
  name: string;
  kind: 'circle' | 'polygon';
  center?: { lat: number; lng: number };
  radiusM?: number;
  polygon?: { lat: number; lng: number }[];
  color?: string;
  rules: { alertOnEnter: boolean; alertOnExit: boolean; alertOnDwellMin: number | null };
  createdAt: string;
}

export interface GeofenceEvent {
  id: ID;
  geofenceId: ID;
  vehicleId: ID;
  type: 'enter' | 'exit' | 'dwell';
  at: string;                    // ISO datetime
  dwellMin?: number;
}

export interface Trip {
  id: ID;
  vehicleId: ID;
  driverId: ID;
  startAt: string;
  endAt: string;
  from: string;
  to: string;
  distanceKm: number;
  durationMin: number;
  idleMin: number;
  maxSpeedKmh: number;
  classification: 'business' | 'private' | 'unclassified';
  corridor: string;
}

export type SafetyEventType = 'harsh_braking' | 'harsh_acceleration' | 'harsh_cornering' | 'speeding' | 'seatbelt' | 'distraction';
export type CoachingStatus = 'new' | 'reviewed' | 'coached' | 'acknowledged';

export interface SafetyEvent {
  id: ID;
  type: SafetyEventType;
  severity: Severity;
  vehicleId: ID;
  driverId: ID;
  at: string;
  location: string;
  speedKmh?: number;
  coachingStatus: CoachingStatus;
  dashcamImage?: string;         // e.g. /dashcam-01.jpg
}

export interface DvirItem {
  key: string;
  label: string;
  result: 'ok' | 'defect' | 'na';
  note?: string;
  photo?: string;
}

export interface Inspection {
  id: ID;
  vehicleId: ID;
  driverId: ID;
  kind: 'pre-trip' | 'post-trip';
  at: string;
  odometerKm: number;
  items: DvirItem[];
  result: 'pass' | 'fail';
  defectsCount: number;
  workOrderId?: ID;
}

export interface Shift {
  id: ID;
  driverId: ID;
  vehicleId: ID | null;
  startAt: string;
  endAt: string | null;
  drivingMin: number;
  restWarning: boolean;
}

export interface DocumentRec {
  id: ID;
  entityType: 'vehicle' | 'driver';
  entityId: ID;
  docType: string;               // Insurance, PSV Badge, Inspection Cert, Driving Licence, RSL
  number: string;
  issuedAt: string;
  expiresAt: string;
  fileName?: string;
}

export type WorkOrderStatus = 'open' | 'approved' | 'in-progress' | 'done' | 'cancelled';

export interface WorkOrderItem {
  description: string;
  qty: number;
  unitCostKes: number;
  partId?: ID;
}

export interface WorkOrder {
  id: ID;
  number: string;                // FBV-WO-000123
  vehicleId: ID;
  source: 'manual' | 'dvir' | 'dtc' | 'schedule';
  status: WorkOrderStatus;
  priority: 'low' | 'medium' | 'high';
  title: string;
  items: WorkOrderItem[];
  laborCostKes: number;
  vendorId: ID | null;
  openedAt: string;
  dueAt: string | null;
  completedAt: string | null;
  notes?: string;
}

export interface MaintenanceSchedule {
  id: ID;
  vehicleId: ID;
  name: string;
  type: 'odometer' | 'engine-hours' | 'calendar';
  intervalKm?: number;
  intervalHours?: number;
  intervalDays?: number;
  lastDoneAt: string;
  lastDoneKm: number;
  nextDueKm?: number;
  nextDueAt?: string;
}

export interface Part {
  id: ID;
  sku: string;
  name: string;
  qty: number;
  reorderLevel: number;
  unitCostKes: number;
}

export interface Vendor {
  id: ID;
  name: string;
  specialty: string;
  phone: string;
  location: string;
  preferred: boolean;
}

export interface FuelLog {
  id: ID;
  vehicleId: ID;
  driverId: ID;
  station: string;
  lat: number;
  lng: number;
  litres: number;
  pricePerLKes: number;
  totalKes: number;
  odometerKm: number;
  at: string;
  anomaly: 'none' | 'location_mismatch' | 'volume_exceeds_tank' | 'consumption_spike';
}

export interface JobStop {
  id: ID;
  label: string;
  address: string;
  lat: number;
  lng: number;
  arrivedAt?: string;
  completedAt?: string;
}

export interface Job {
  id: ID;
  number: string;                // FBV-JOB-000458
  customer: string;
  vehicleId: ID | null;
  driverId: ID | null;
  status: 'draft' | 'assigned' | 'en-route' | 'arrived' | 'delivered' | 'cancelled';
  stops: JobStop[];
  createdAt: string;
  scheduledAt: string;
  pod?: { signedBy: string; at: string; photo?: string; notes?: string; signature?: string };
}

export interface Asset {
  id: ID;
  type: 'trailer' | 'generator' | 'equipment';
  name: string;
  tag: string;
  status: 'assigned' | 'available' | 'maintenance';
  assignedVehicleId: ID | null;
  utilizationPct: number;
  purchaseCostKes: number;
}

export type AlertType = 'speeding' | 'geofence' | 'harsh_event' | 'fuel_anomaly' | 'document_expiry' | 'maintenance_due' | 'dtc' | 'device_offline' | 'shift_violation';

export interface AlertRec {
  id: ID;
  type: AlertType;
  severity: Severity;
  message: string;
  entityRef: { kind: 'vehicle' | 'driver' | 'document' | 'job' | 'system'; id: ID; label: string };
  at: string;
  read: boolean;
  acknowledged: boolean;
}

export type Role = 'Admin' | 'Fleet Manager' | 'Dispatcher' | 'Mechanic' | 'Driver' | 'Read-only';

export interface AppUser {
  id: ID;
  name: string;
  email: string;
  role: Role;
  phone?: string;
  active: boolean;
  lastLoginAt: string | null;
}

export interface AuditEntry {
  id: ID;
  at: string;
  userId: ID;
  userName: string;
  action: 'create' | 'update' | 'delete' | 'login' | 'export' | 'import';
  collection: string;
  recordId: string;
  summary: string;
  diff?: { field: string; before: unknown; after: unknown }[];
}

export interface RewardStanding {
  driverId: ID;
  month: string;                 // "2026-07"
  points: number;
  rank: number;
  badges: string[];
  trend: 'up' | 'down' | 'flat';
}

export interface CompanyProfile {
  name: string;
  country: string;
  city: string;
  address: string;
  phone: string;
  email: string;
  currency: 'KES';
  timezone: 'Africa/Nairobi';
}

export interface Settings {
  speedLimitKmh: number;
  idleAlertMin: number;
  docExpiryWarnDays: number[];
  fuelPriceDieselKes: number;
  fuelPricePetrolKes: number;
  sequences: { wo: number; job: number; driver: number; vehicle: number };
  alertPrefs: Record<string, boolean>;
}

/** All persisted collections. */
export interface FleetCollections {
  vehicles: Vehicle[];
  drivers: Driver[];
  geofences: Geofence[];
  geofenceEvents: GeofenceEvent[];
  trips: Trip[];
  safetyEvents: SafetyEvent[];
  inspections: Inspection[];
  shifts: Shift[];
  documents: DocumentRec[];
  workOrders: WorkOrder[];
  schedules: MaintenanceSchedule[];
  parts: Part[];
  vendors: Vendor[];
  fuelLogs: FuelLog[];
  jobs: Job[];
  assets: Asset[];
  alerts: AlertRec[];
  users: AppUser[];
  audit: AuditEntry[];
  rewards: RewardStanding[];
}

export type CollectionName = keyof FleetCollections;

/** Live position from the telematics layer (transient, not persisted). */
export interface LivePosition {
  vehicleId: ID;
  lat: number;
  lng: number;
  speedKmh: number;
  heading: number;               // degrees, 0 = north
  ignition: boolean;
  status: VehicleStatus;
  at: number;                    // epoch ms
}
