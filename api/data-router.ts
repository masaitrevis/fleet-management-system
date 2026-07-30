import { z } from "zod";
import { createRouter, authedQuery, adminQuery } from "./middleware";
import {
  bulkUpsertEntities,
  clearAllData,
  entityCount,
  exportAll,
  getAllEntities,
  getKv,
  importAll,
  listEntities,
  nextSequence,
  peekSequences,
  removeEntity,
  seedIfEmpty,
  setKv,
  upsertEntity,
} from "./queries/entities";

export const COLLECTIONS = [
  "vehicles",
  "drivers",
  "geofences",
  "geofenceEvents",
  "trips",
  "safetyEvents",
  "inspections",
  "shifts",
  "documents",
  "workOrders",
  "schedules",
  "parts",
  "vendors",
  "fuelLogs",
  "jobs",
  "assets",
  "alerts",
  "users",
  "audit",
  "rewards",
] as const;

const collectionEnum = z.enum(COLLECTIONS);

const dumpSchema = z.object({
  entities: z.record(z.string(), z.array(z.any())),
  kv: z
    .object({ profile: z.any().optional(), settings: z.any().optional() })
    .optional(),
  sequences: z.record(z.string(), z.number()).optional(),
});

export const dataRouter = createRouter({
  /** Everything the frontend store needs to hydrate in one round-trip. */
  getState: authedQuery.query(async () => ({
    entities: await getAllEntities(),
    profile: await getKv("profile"),
    settings: await getKv("settings"),
    sequences: await peekSequences(),
  })),

  list: authedQuery
    .input(z.object({ collection: collectionEnum }))
    .query(({ input }) => listEntities(input.collection)),

  upsert: authedQuery
    .input(z.object({ collection: collectionEnum, item: z.any() }))
    .mutation(async ({ input }) => {
      await upsertEntity(input.collection, input.item);
      return { ok: true };
    }),

  /** Bulk Excel import — single transaction, idempotent upserts. */
  bulkUpsert: authedQuery
    .input(
      z.object({
        collection: collectionEnum,
        items: z.array(z.any()).max(5000),
      }),
    )
    .mutation(async ({ input }) => ({
      ok: true,
      count: await bulkUpsertEntities(input.collection, input.items),
    })),

  remove: authedQuery
    .input(z.object({ collection: collectionEnum, id: z.string() }))
    .mutation(async ({ input }) => {
      await removeEntity(input.collection, input.id);
      return { ok: true };
    }),

  updateProfile: authedQuery
    .input(z.object({ profile: z.any() }))
    .mutation(async ({ input }) => {
      await setKv("profile", input.profile);
      return { ok: true };
    }),

  updateSettings: authedQuery
    .input(z.object({ settings: z.any() }))
    .mutation(async ({ input }) => {
      await setKv("settings", input.settings);
      return { ok: true };
    }),

  /** Atomic document numbering — returns e.g. "FBV-QUO-2026-004". */
  nextDocNumber: authedQuery
    .input(
      z.object({
        prefix: z.string().min(1).max(20),
        year: z.number().int().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const seqPrefix = input.year ? `${input.prefix}${input.year}` : input.prefix;
      const n = await nextSequence(seqPrefix);
      return {
        number: input.year
          ? `${input.prefix}${input.year}-${String(n).padStart(3, "0")}`
          : `${input.prefix}-${String(n).padStart(6, "0")}`,
        value: n,
      };
    }),

  exportAll: authedQuery.query(() => exportAll()),

  importAll: authedQuery
    .input(z.object({ dump: dumpSchema }))
    .mutation(async ({ input }) => {
      await importAll(input.dump);
      return { ok: true };
    }),

  /** First-run seed — no-op when data already exists. */
  seedIfEmpty: authedQuery
    .input(z.object({ dump: dumpSchema }))
    .mutation(async ({ input }) => ({ seeded: await seedIfEmpty(input.dump) })),

  /** Health/introspection used by the integration audit. */
  stats: authedQuery.query(async () => ({
    entityCount: await entityCount(),
    sequences: await peekSequences(),
  })),

  /**
   * Admin-only: wipe ALL app data (every collection + doc numbering),
   * optionally including company profile & settings. Leaves a single
   * audit-trail marker so first-run demo seeding never re-triggers.
   */
  clearAll: adminQuery
    .input(z.object({ includeProfile: z.boolean().default(false) }))
    .mutation(async ({ input, ctx }) => {
      const actor =
        ctx.user.name ?? ctx.user.username ?? ctx.user.unionId ?? "admin";
      return clearAllData({ includeProfile: input.includeProfile, actor });
    }),
});
