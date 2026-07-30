/**
 * FBV FleetOS — backend integration suite against the REAL dev database.
 * Verifies auth guards, CRUD across representative collections (incl.
 * camelCase names), bulk idempotency, atomic no-year doc numbering,
 * profile/settings persistence, export/import, seedIfEmpty, clearAll
 * (wipe + audit marker + re-seed block), and leaves the DB EMPTY.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TRPCClientError } from "@trpc/client";
import { appRouter } from "./router";
import { COLLECTIONS } from "./data-router";
import { getDb } from "./queries/connection";
import * as schema from "@db/schema";
import { eq, like } from "drizzle-orm";
import type { User } from "@db/schema";

const adminUser = {
  id: 1,
  unionId: "audit",
  name: "Audit Bot",
  email: null,
  avatar: null,
  username: null,
  passwordHash: null,
  role: "admin",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignInAt: new Date(),
} as unknown as User;

const authCtx = {
  req: new Request("http://audit.local"),
  resHeaders: new Headers(),
  user: adminUser,
};
const anonCtx = { req: new Request("http://audit.local"), resHeaders: new Headers() };
const nonAdmin = appRouter.createCaller({
  req: new Request("http://audit.local"),
  resHeaders: new Headers(),
  user: { ...adminUser, role: "user" } as unknown as User,
});

const authed = appRouter.createCaller(authCtx);
const anon = appRouter.createCaller(anonCtx);

const AUDIT_PREFIX = "AUD-TST";

let preProfile: unknown = null;
let preSettings: unknown = null;

function expectUnauthorized(p: Promise<unknown>) {
  return expect(p).rejects.toSatisfy(
    (e) =>
      (e instanceof TRPCClientError && e.data?.code === "UNAUTHORIZED") ||
      (e as { code?: string }).code === "UNAUTHORIZED" ||
      String(e).includes("UNAUTHORIZED"),
  );
}

beforeAll(async () => {
  const state = await authed.data.getState();
  preProfile = state.profile;
  preSettings = state.settings;
});

describe("1. auth guard", () => {
  it("rejects unauthenticated calls with UNAUTHORIZED", async () => {
    await expectUnauthorized(anon.data.getState());
    await expectUnauthorized(anon.data.list({ collection: "vehicles" }));
    await expectUnauthorized(
      anon.data.bulkUpsert({ collection: "vehicles", items: [] }),
    );
    await expectUnauthorized(anon.data.exportAll());
    await expectUnauthorized(
      anon.data.seedIfEmpty({ dump: { entities: {} } }),
    );
    await expectUnauthorized(anon.data.clearAll({ includeProfile: false }));
    await expectUnauthorized(
      anon.data.nextDocNumber({ prefix: AUDIT_PREFIX }),
    );
  });

  it("rejects clearAll for non-admin with FORBIDDEN", async () => {
    await expect(
      nonAdmin.data.clearAll({ includeProfile: false }),
    ).rejects.toSatisfy(
      (e) =>
        (e as { data?: { code?: string } }).data?.code === "FORBIDDEN" ||
        (e as { code?: string }).code === "FORBIDDEN" ||
        String(e).includes("FORBIDDEN"),
    );
  });

  it("exposes all 20 fleet collections", () => {
    expect(COLLECTIONS).toHaveLength(20);
    expect(COLLECTIONS).toContain("vehicles");
    expect(COLLECTIONS).toContain("geofenceEvents");
    expect(COLLECTIONS).toContain("safetyEvents");
    expect(COLLECTIONS).toContain("workOrders");
    expect(COLLECTIONS).toContain("fuelLogs");
    expect(COLLECTIONS).toContain("rewards");
  });
});

describe("2. CRUD + bulk idempotency on representative collections", () => {
  const payload = (id: string) => ({
    id,
    plate: "KDJ 999Z",
    name: "Audit 北京 🤝 Über-truck",
    cost: 12345.67,
    active: true,
    nested: { deep: { list: [1, 2, 3] } },
    unknownExtensionKey: { future: "field" },
  });

  for (const collection of [
    "vehicles",
    "drivers",
    "geofenceEvents",
    "safetyEvents",
    "workOrders",
    "fuelLogs",
    "trips",
    "alerts",
    "rewards",
  ] as const) {
    it(`round-trips ${collection}: create → read → update → delete`, async () => {
      const id = `audit-${collection}-1`;
      await authed.data.upsert({ collection, item: payload(id) });
      let list = (await authed.data.list({ collection })) as {
        id: string;
        plate?: string;
      }[];
      const row = list.find((r) => r.id === id);
      expect(row).toBeTruthy();
      expect(row?.plate).toBe("KDJ 999Z");

      await authed.data.upsert({
        collection,
        item: { ...payload(id), cost: 999 },
      });
      list = (await authed.data.list({ collection })) as {
        id: string;
        cost?: number;
      }[];
      expect(list.filter((r) => r.id === id)).toHaveLength(1);
      expect(
        (list.find((r) => r.id === id) as { cost?: number } | undefined)?.cost,
      ).toBe(999);

      await authed.data.remove({ collection, id });
      list = (await authed.data.list({ collection })) as { id: string }[];
      expect(list.find((r) => r.id === id)).toBeUndefined();
    });
  }

  it("bulkUpsert twice → no duplicates, extension fields preserved", async () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      id: `audit-bulk-${i}`,
      idx: i,
      ext: { a: [i] },
    }));
    await authed.data.bulkUpsert({ collection: "vehicles", items });
    await authed.data.bulkUpsert({ collection: "vehicles", items });
    const list = (await authed.data.list({ collection: "vehicles" })) as {
      id: string;
      ext?: { a: number[] };
    }[];
    const mine = list.filter((r) => r.id.startsWith("audit-bulk-"));
    expect(mine).toHaveLength(50);
    expect(mine.find((r) => r.id === "audit-bulk-7")?.ext).toEqual({ a: [7] });
    for (const r of mine) {
      await authed.data.remove({ collection: "vehicles", id: r.id });
    }
  });
});

describe("3. atomic doc numbering (no-year prefix)", () => {
  it("20 concurrent calls → 20 unique sequential FBV-WO-style numbers", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        authed.data.nextDocNumber({ prefix: AUDIT_PREFIX }),
      ),
    );
    const values = results.map((r) => r.value).sort((a, b) => a - b);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBe(values[i - 1] + 1);
    }
    expect(results[0].number).toMatch(/^AUD-TST-\d{6}$/);
    const db = getDb();
    await db
      .delete(schema.docSequences)
      .where(like(schema.docSequences.prefix, `${AUDIT_PREFIX}%`));
  }, 60_000);
});

describe("4. kv + export/import + seedIfEmpty", () => {
  it("updateProfile/updateSettings reflected by getState, unknown keys survive", async () => {
    await authed.data.updateProfile({
      profile: { companyName: "Audit Fleet Co", futureField: { x: 1 } },
    });
    await authed.data.updateSettings({
      settings: { currency: "KES", brandNewSetting: [1, 2] },
    });
    const state = await authed.data.getState();
    expect(state.profile).toEqual({
      companyName: "Audit Fleet Co",
      futureField: { x: 1 },
    });
    expect(state.settings).toEqual({
      currency: "KES",
      brandNewSetting: [1, 2],
    });
  });

  it("exportAll → parse → importAll → identical state", async () => {
    await authed.data.bulkUpsert({
      collection: "drivers",
      items: [{ id: "audit-exp-1", name: "Export Me" }],
    });
    const dump = await authed.data.exportAll();
    const round = JSON.parse(JSON.stringify(dump));
    await authed.data.importAll({ dump: round });
    const list = (await authed.data.list({ collection: "drivers" })) as {
      id: string;
      name: string;
    }[];
    expect(list.find((r) => r.id === "audit-exp-1")?.name).toBe("Export Me");
    await authed.data.remove({ collection: "drivers", id: "audit-exp-1" });
  }, 120_000);

  it("seedIfEmpty is a no-op when entities exist", async () => {
    const before = await authed.data.stats();
    const res = await authed.data.seedIfEmpty({
      dump: { entities: { vehicles: [{ id: "audit-nope" }] } },
    });
    if (before.entityCount > 0) {
      expect(res.seeded).toBe(false);
      const after = await authed.data.stats();
      expect(after.entityCount).toBe(before.entityCount);
    } else {
      expect(res.seeded).toBe(true);
      await authed.data.remove({ collection: "vehicles", id: "audit-nope" });
    }
  });
});

describe("5. clearAll (admin-only full wipe)", () => {
  it("wipes every collection + sequences, keeps kv, leaves audit marker, blocks re-seed", async () => {
    await authed.data.bulkUpsert({
      collection: "vehicles",
      items: [{ id: "audit-clr-1" }, { id: "audit-clr-2" }],
    });
    await authed.data.bulkUpsert({
      collection: "trips",
      items: [{ id: "audit-clr-3" }],
    });
    await authed.data.nextDocNumber({ prefix: AUDIT_PREFIX });
    await authed.data.updateProfile({ profile: { companyName: "Audit Co" } });

    const res = await authed.data.clearAll({ includeProfile: false });
    expect(res.deleted).toBeGreaterThanOrEqual(3);

    const stats = await authed.data.stats();
    expect(stats.entityCount).toBe(1); // only the audit marker
    expect(stats.sequences).toEqual({});

    for (const collection of COLLECTIONS) {
      const list = await authed.data.list({ collection });
      if (collection === "audit") {
        expect(list).toHaveLength(1);
        const marker = list[0] as { action: string; entityRef: string };
        expect(marker.action).toBe("Cleared");
        expect(marker.entityRef).toBe("ALL");
      } else {
        expect(list).toHaveLength(0);
      }
    }

    const state = await authed.data.getState();
    expect(state.profile).toEqual({ companyName: "Audit Co" });

    const seeded = await authed.data.seedIfEmpty({
      dump: { entities: { vehicles: [{ id: "audit-nope-2" }] } },
    });
    expect(seeded.seeded).toBe(false);
    expect(await authed.data.list({ collection: "vehicles" })).toHaveLength(0);
  });

  it("includeProfile=true also clears the kv singletons", async () => {
    await authed.data.updateProfile({ profile: { companyName: "Audit Co" } });
    await authed.data.bulkUpsert({
      collection: "vehicles",
      items: [{ id: "audit-clr-9" }],
    });
    await authed.data.clearAll({ includeProfile: true });
    const state = await authed.data.getState();
    expect(state.profile).toBeNull();
    expect(state.settings).toBeNull();
    expect((await authed.data.stats()).entityCount).toBe(1);
  });
});

afterAll(async () => {
  // ---- MANDATORY CLEANUP — leave the dev DB empty ----
  const caller = appRouter.createCaller(authCtx);
  const db = getDb();
  if (preProfile != null) await caller.data.updateProfile({ profile: preProfile });
  else await db.delete(schema.kvStore).where(eq(schema.kvStore.k, "profile"));
  if (preSettings != null) await caller.data.updateSettings({ settings: preSettings });
  else await db.delete(schema.kvStore).where(eq(schema.kvStore.k, "settings"));

  await caller.data.importAll({ dump: { entities: {}, kv: {}, sequences: {} } });
  await db
    .delete(schema.docSequences)
    .where(like(schema.docSequences.prefix, `${AUDIT_PREFIX}%`));

  const stats = await caller.data.stats();
  const remainingSeq = Object.keys(stats.sequences).filter((k) =>
    k.startsWith(AUDIT_PREFIX),
  );
  if (stats.entityCount !== 0 || remainingSeq.length > 0) {
    throw new Error(
      `CLEANUP FAILED: entityCount=${stats.entityCount}, seqLeft=${remainingSeq.join(",")}`,
    );
  }
  console.log("[fleet-audit] cleanup OK — DB left empty");
});
