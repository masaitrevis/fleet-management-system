// FBV FleetOS — client data store (zustand + localStorage persistence).
//
// API surface (page agents build against this; the backend phase rewires
// the internals to a server without changing these exports):
//
//   useFleetStore            — zustand hook (full state)
//   useCollection(name)      — reactive array for a collection
//   list(name)               — non-reactive snapshot of a collection
//   getById(name, id)        — single record or undefined
//   add(name, record)        — insert (assigns `id` if missing), returns record
//   update(name, id, patch)  — shallow-merge patch, returns updated record
//   remove(name, id)         — delete
//   kvGet(key) / kvSet(key, value)   — 'profile' | 'settings' + arbitrary keys
//   exportJSON()             — full backup as pretty JSON string
//   importJSON(json)         — restore from backup (throws on invalid)
//   resetToSeed()            — wipe + reseed demo data
//   clearAllData()           — wipe everything (empty collections)
//   nextSequence(kind)       — 'wo' | 'job' | 'driver' | 'vehicle' → "FBV-WO-000124"
//
// Live telematics state (transient, not persisted):
//   useLiveStore             — { positions: Map, running, trailsVersion }
//
// Persistence: localStorage key 'fbv-fleet-store', { version, collections, kv }.

import { create } from 'zustand';
import { useMemo } from 'react';
import type { CollectionName, FleetCollections, LivePosition } from './types';
import { seedCollections, seedProfile, seedSettings } from './seed';

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

function freshState(): FleetState {
  return { collections: seedCollections(), kv: { profile: seedProfile(), settings: seedSettings() } };
}

function loadInitial(): FleetState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw) as { version: number; collections: FleetCollections; kv: KV };
    if (parsed.version !== STORE_VERSION || !parsed.collections) return freshState();
    return { collections: parsed.collections, kv: parsed.kv };
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

/* ---------------- writes ---------------- */

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
}

export function kvSet<K extends keyof KV>(key: K, value: KV[K]): void {
  commit((s) => ({ ...s, kv: { ...s.kv, [key]: value } }));
}

/* ---------------- sequences ---------------- */

export function nextSequence(kind: 'wo' | 'job' | 'driver' | 'vehicle'): string {
  const settings = kvGet('settings');
  const n = settings.sequences[kind];
  kvSet('settings', { ...settings, sequences: { ...settings.sequences, [kind]: n + 1 } });
  const prefix = { wo: 'FBV-WO', job: 'FBV-JOB', driver: 'FBV-DRV', vehicle: 'FBV-VEH' }[kind];
  return `${prefix}-${String(n).padStart(6, '0')}`;
}

/* ---------------- backup / restore ---------------- */

export function exportJSON(): string {
  const s = useFleetStore.getState();
  return JSON.stringify({ version: STORE_VERSION, exportedAt: new Date().toISOString(), collections: s.collections, kv: s.kv }, null, 2);
}

export function importJSON(json: string): void {
  const parsed = JSON.parse(json) as { collections?: FleetCollections; kv?: KV };
  if (!parsed.collections || typeof parsed.collections !== 'object') {
    throw new Error('Invalid backup file: missing collections');
  }
  const seed = seedCollections();
  const merged = { ...seed, ...parsed.collections };
  commit((s) => ({ ...s, collections: merged, kv: { ...s.kv, ...(parsed.kv ?? {}) } }));
}

export function resetToSeed(): void {
  const fresh = freshState();
  useFleetStore.setState(fresh);
  persist(fresh);
}

export function clearAllData(): void {
  const empty = Object.fromEntries(
    Object.keys(seedCollections()).map((k) => [k, []]),
  ) as unknown as FleetCollections;
  const state: FleetState = { collections: empty, kv: { profile: seedProfile(), settings: seedSettings() } };
  useFleetStore.setState(state);
  persist(state);
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
