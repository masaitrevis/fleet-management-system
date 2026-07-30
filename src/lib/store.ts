// FBV FleetOS — client data store (zustand + localStorage optimistic cache,
// server-authoritative sync via tRPC).
//
// API surface (page agents build against this):
//
//   useFleetStore            — zustand hook (full state)
//   useCollection(name)      — reactive array for a collection
//   list(name)               — non-reactive snapshot of a collection
//   getById(name, id)        — single record or undefined
//   add(name, record)        — insert (assigns `id` if missing), returns record
//   update(name, id, patch)  — shallow-merge patch, returns updated record
//   remove(name, id)         — delete
//   kvGet(key) / kvSet(key, value)   — 'profile' | 'settings' + arbitrary keys
//   exportJSON()             — Promise<string> full backup (server export)
//   importJSON(json)         — Promise<void> restore (server import + refresh)
//   resetToSeed()            — Promise<void> wipe + reseed demo data on server
//   clearAllData(opts?)      — Promise<void> ADMIN server wipe (audit marker,
//                              no re-seed) + local cache drop
//   nextSequence(kind)       — Promise<string> 'wo' | 'job' | 'driver' |
//                              'vehicle' → "FBV-WO-000124" (atomic server-side)
//   syncStore()              — start server sync (called once when authed)
//   refreshFromServer()      — Promise<void> re-pull authoritative state
//   clearLocalCache()        — drop the localStorage cache
//
// Live telematics state (transient, not persisted):
//   useLiveStore             — { positions: Map, running, trailsVersion }
//
// Persistence: localStorage key 'fbv-fleet-store', { version, collections, kv }.

import { create } from 'zustand';
import { useMemo } from 'react';
import type { CollectionName, FleetCollections, LivePosition } from './types';
import { seedCollections, seedProfile, seedSettings } from './seed';
import { api } from './api';

const STORAGE_KEY = 'fbv-fleet-store';
const STORE_VERSION = 1;

interface KV {
  profile: ReturnType<typeof seedProfile>;
  settings: ReturnType<typeof seedSettings>;
  [key: string]: unknown;
}

interface FleetState {
  collections: FleetCollections;
  kv: KV;
}

const COLLECTION_KEYS = [
  'vehicles', 'drivers', 'geofences', 'geofenceEvents', 'trips', 'safetyEvents',
  'inspections', 'shifts', 'documents', 'workOrders', 'schedules', 'parts',
  'vendors', 'fuelLogs', 'jobs', 'assets', 'alerts', 'users', 'audit', 'rewards',
] as const;

function freshState(): FleetState {
  return { collections: seedCollections(), kv: { profile: seedProfile(), settings: seedSettings() } };
}

function emptyCollections(): FleetCollections {
  return Object.fromEntries(COLLECTION_KEYS.map((k) => [k, []])) as unknown as FleetCollections;
}

function loadInitial(): FleetState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw) as { version: number; collections: FleetCollections; kv: KV };
    if (parsed.version !== STORE_VERSION || !parsed.collections) return freshState();
    // Guard: a cache missing whole collections (e.g. written by an older build)
    // is repaired with empty arrays rather than crashing selectors.
    const repaired = { ...emptyCollections(), ...parsed.collections };
    return { collections: repaired, kv: parsed.kv };
  } catch {
    return freshState();
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persist(state: FleetState) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: STORE_VERSION,
        collections: state.collections,
        kv: state.kv,
      }));
    } catch (e) {
      console.warn('[fleet-store] persist failed', e);
    }
  }, 250);
}

export const useFleetStore = create<FleetState>(() => loadInitial());

function commit(updater: (s: FleetState) => FleetState) {
  useFleetStore.setState((s) => {
    const next = updater(s);
    persist(next);
    return next;
  });
}

/* ---------------- reactive selectors ---------------- */

/** Reactive collection array. */
export function useCollection<K extends CollectionName>(name: K): FleetCollections[K] {
  return useFleetStore((s) => s.collections[name]);
}

/** Reactive kv value. */
export function useKV<K extends keyof KV>(key: K): KV[K] {
  return useFleetStore((s) => s.kv[key]);
}

/* ---------------- non-reactive reads ---------------- */

export function list<K extends CollectionName>(name: K): FleetCollections[K] {
  return useFleetStore.getState().collections[name];
}

export function getById<K extends CollectionName>(name: K, id: string): FleetCollections[K][number] | undefined {
  return (useFleetStore.getState().collections[name] as { id: string }[]).find((r) => r.id === id) as unknown as FleetCollections[K][number] | undefined;
}

export function kvGet<K extends keyof KV>(key: K): KV[K] {
  return useFleetStore.getState().kv[key];
}

/* ------------------------------------------------------------------ */
/* Server sync layer                                                   */
/* ------------------------------------------------------------------ */

type SyncOp =
  | { op: 'upsert'; collection: string; item: { id: string } }
  | { op: 'remove'; collection: string; id: string }
  | { op: 'kv'; key: 'profile' | 'settings'; value: unknown };

let syncEnabled = false;
let hydratePromise: Promise<void> | null = null;
let opQueue: SyncOp[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

export const SYNC_ERROR_EVENT = 'fbv-fleet-sync-error';

function queueOp(op: SyncOp) {
  if (!syncEnabled) return; // pre-auth / offline: local-only
  opQueue.push(op);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flushOps, 400);
}

async function flushOps(): Promise<void> {
  if (flushing) return;
  const ops = opQueue;
  opQueue = [];
  if (ops.length === 0) return;
  flushing = true;
  try {
    const upserts = new Map<string, { id: string }[]>();
    const removals: { collection: string; id: string }[] = [];
    for (const op of ops) {
      if (op.op === 'upsert') {
        // last-write-wins per record within the batch
        const arr = upserts.get(op.collection) ?? [];
        const idx = arr.findIndex((i) => i.id === op.item.id);
        if (idx >= 0) arr[idx] = op.item; else arr.push(op.item);
        upserts.set(op.collection, arr);
      } else if (op.op === 'remove') {
        removals.push({ collection: op.collection, id: op.id });
        const arr = upserts.get(op.collection);
        if (arr) upserts.set(op.collection, arr.filter((i) => i.id !== op.id));
      } else if (op.key === 'profile') {
        await api.data.updateProfile.mutate({ profile: op.value });
      } else {
        await api.data.updateSettings.mutate({ settings: op.value });
      }
    }
    for (const [collection, items] of upserts) {
      if (items.length > 0) {
        await api.data.bulkUpsert.mutate({ collection: collection as never, items });
      }
    }
    for (const r of removals) {
      await api.data.remove.mutate({ collection: r.collection as never, id: r.id });
    }
  } catch (err) {
    console.error('[fleet-store] sync failed — server copy may lag.', err);
    window.dispatchEvent(new CustomEvent(SYNC_ERROR_EVENT, { detail: err }));
  } finally {
    flushing = false;
    if (opQueue.length > 0) {
      flushTimer = setTimeout(flushOps, 400);
    }
  }
}

function stateToDump(s: FleetState) {
  const entities: Record<string, unknown[]> = {};
  for (const k of COLLECTION_KEYS) entities[k] = s.collections[k] as unknown[];
  return { entities, kv: { profile: s.kv.profile, settings: s.kv.settings }, sequences: {} };
}

function dumpToState(dump: {
  entities?: Record<string, unknown[]>;
  profile?: unknown;
  settings?: unknown;
}): FleetState {
  const collections = emptyCollections();
  for (const k of COLLECTION_KEYS) {
    const list = dump.entities?.[k];
    if (Array.isArray(list)) (collections as unknown as Record<string, unknown[]>)[k] = list;
  }
  const kv: KV = { profile: seedProfile(), settings: seedSettings() };
  if (dump.profile && typeof dump.profile === 'object') kv.profile = dump.profile as KV['profile'];
  if (dump.settings && typeof dump.settings === 'object') kv.settings = dump.settings as KV['settings'];
  return { collections, kv };
}

async function hydrate(): Promise<void> {
  // Push any pending local writes first so they are not overwritten.
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  await flushOps();

  let remote = await api.data.getState.query();
  const isEmpty = COLLECTION_KEYS.every((k) => (remote.entities?.[k] ?? []).length === 0);
  if (isEmpty) {
    // First run for this deployment — seed the demo dataset, then read back.
    await api.data.seedIfEmpty.mutate({ dump: stateToDump(freshState()) });
    remote = await api.data.getState.query();
  }
  const next = dumpToState(remote);
  useFleetStore.setState(next);
  persist(next);
}

/** Enable server sync and perform the first hydration. Call once authed. */
export function syncStore(): void {
  if (syncEnabled) return;
  syncEnabled = true;
  hydratePromise = hydrate().catch((err) => {
    console.error('[fleet-store] hydration failed (offline or signed out).', err);
  });
}

/** Re-read the full state from the server (after imports/resets). */
export async function refreshFromServer(): Promise<void> {
  if (!syncEnabled) return;
  await (hydratePromise ?? Promise.resolve());
  hydratePromise = hydrate();
  await hydratePromise;
}

/** Drop the localStorage cache (used after a server-side full wipe). */
export function clearLocalCache(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

/* ---------------- writes (optimistic + queued sync) ---------------- */

let idCounter = 0;
function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
}

export function add<K extends CollectionName>(name: K, record: FleetCollections[K][number]): FleetCollections[K][number] {
  const rec = { ...record } as { id?: string };
  if (!rec.id) rec.id = newId(String(name).slice(0, 4));
  commit((s) => ({
    ...s,
    collections: {
      ...s.collections,
      [name]: [...(s.collections[name] as unknown[]), rec],
    },
  }));
  queueOp({ op: 'upsert', collection: String(name), item: rec as { id: string } });
  return rec as FleetCollections[K][number];
}

export function update<K extends CollectionName>(
  name: K, id: string, patch: Partial<FleetCollections[K][number]>,
): FleetCollections[K][number] | undefined {
  let updated: FleetCollections[K][number] | undefined;
  commit((s) => {
    const arr = (s.collections[name] as { id: string }[]).map((r) =>
      r.id === id ? { ...r, ...patch } : r);
    updated = arr.find((r) => r.id === id) as unknown as FleetCollections[K][number] | undefined;
    return { ...s, collections: { ...s.collections, [name]: arr } };
  });
  if (updated) queueOp({ op: 'upsert', collection: String(name), item: updated as { id: string } });
  return updated;
}

export function remove<K extends CollectionName>(name: K, id: string): void {
  commit((s) => ({
    ...s,
    collections: {
      ...s.collections,
      [name]: (s.collections[name] as { id: string }[]).filter((r) => r.id !== id),
    },
  }));
  queueOp({ op: 'remove', collection: String(name), id });
}

export function kvSet<K extends keyof KV>(key: K, value: KV[K]): void {
  commit((s) => ({ ...s, kv: { ...s.kv, [key]: value } }));
  if (key === 'profile' || key === 'settings') {
    queueOp({ op: 'kv', key, value });
  }
}

/* ---------------- sequences (atomic server-side) ---------------- */

const SEQ_PREFIX = { wo: 'FBV-WO', job: 'FBV-JOB', driver: 'FBV-DRV', vehicle: 'FBV-VEH' } as const;

export async function nextSequence(kind: 'wo' | 'job' | 'driver' | 'vehicle'): Promise<string> {
  const prefix = SEQ_PREFIX[kind];
  if (!syncEnabled) {
    // Offline/dev fallback — local counter from settings.
    const settings = kvGet('settings');
    const n = settings.sequences[kind];
    kvSet('settings', { ...settings, sequences: { ...settings.sequences, [kind]: n + 1 } });
    return `${prefix}-${String(n).padStart(6, '0')}`;
  }
  const ref = await api.data.nextDocNumber.mutate({ prefix });
  return `${prefix}-${String(ref.value).padStart(6, '0')}`;
}

/* ---------------- backup / restore (server-side) ---------------- */

export async function exportJSON(): Promise<string> {
  if (!syncEnabled) {
    const s = useFleetStore.getState();
    return JSON.stringify({ version: STORE_VERSION, exportedAt: new Date().toISOString(), collections: s.collections, kv: s.kv }, null, 2);
  }
  await flushOps();
  const dump = await api.data.exportAll.query();
  return JSON.stringify({ version: STORE_VERSION, exportedAt: new Date().toISOString(), ...dump }, null, 2);
}

export async function importJSON(json: string): Promise<void> {
  const parsed = JSON.parse(json) as {
    entities?: Record<string, unknown[]>;
    collections?: FleetCollections;
    kv?: { profile?: unknown; settings?: unknown };
  };
  // Accept both server dumps ({entities, kv}) and legacy local exports ({collections, kv}).
  const entities = parsed.entities ?? (parsed.collections as unknown as Record<string, unknown[]>) ?? {};
  if (!entities || typeof entities !== 'object' || Object.keys(entities).length === 0) {
    throw new Error('Invalid backup file: missing entities/collections');
  }
  const dump = { entities, kv: { profile: parsed.kv?.profile, settings: parsed.kv?.settings }, sequences: {} };
  if (!syncEnabled) {
    useFleetStore.setState(dumpToState(dump));
    persist(useFleetStore.getState());
    return;
  }
  await api.data.importAll.mutate({ dump });
  await refreshFromServer();
}

export async function resetToSeed(): Promise<void> {
  if (!syncEnabled) {
    const fresh = freshState();
    useFleetStore.setState(fresh);
    persist(fresh);
    return;
  }
  await api.data.importAll.mutate({ dump: stateToDump(freshState()) });
  await refreshFromServer();
}

/** ADMIN: wipe everything server-side (single audit marker; no re-seed). */
export async function clearAllData(opts?: { includeProfile?: boolean }): Promise<void> {
  if (!syncEnabled) {
    const state: FleetState = { collections: emptyCollections(), kv: { profile: seedProfile(), settings: seedSettings() } };
    useFleetStore.setState(state);
    persist(state);
    return;
  }
  await api.data.clearAll.mutate({ includeProfile: opts?.includeProfile ?? false });
  await refreshFromServer();
  clearLocalCache();
}

/* ------------------------------------------------------------------ */
/* Live telematics store (transient)                                   */
/* ------------------------------------------------------------------ */

interface LiveState {
  positions: Map<string, LivePosition>;
  running: boolean;
  /** bumped every tick so trails can be re-read cheaply */
  trailsVersion: number;
}

export const useLiveStore = create<LiveState>(() => ({
  positions: new Map(),
  running: false,
  trailsVersion: 0,
}));

/** Convenience hook: positions array (memoized per tick). */
export function useLivePositions(): LivePosition[] {
  const positions = useLiveStore((s) => s.positions);
  return useMemo(() => Array.from(positions.values()), [positions]);
}
