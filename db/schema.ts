import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  json,
  int,
  index,
  uniqueIndex,
  // bigint,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  // Local (username/password) login — used on self-hosted deployments where
  // Kimi OAuth is unavailable. Null for pure Kimi-OAuth users.
  username: varchar("username", { length: 120 }).unique(),
  passwordHash: varchar("passwordHash", { length: 255 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ---------------------------------------------------------------------------
// FBV app data model — collection-based entity store.
// Each frontend collection (clients, suppliers, tenders, …) is stored as rows
// of (collection, id) with a JSON payload so all frontend extension fields are
// preserved without schema churn.
// ---------------------------------------------------------------------------

export const entities = mysqlTable(
  "entities",
  {
    // Surrogate PK: TiDB clustered-index hints on varchar/composite PKs are not
    // introspectable by drizzle-kit, so a serial PK keeps db:push idempotent.
    rowId: serial("rowId").primaryKey(),
    id: varchar("id", { length: 80 }).notNull(),
    collection: varchar("collection", { length: 40 }).notNull(),
    data: json("data").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_entities_collection_id").on(t.collection, t.id),
    index("idx_entities_collection").on(t.collection),
  ],
);

export type Entity = typeof entities.$inferSelect;

/** Singleton key/value rows: 'profile' (CompanyProfile), 'settings' (Settings). */
export const kvStore = mysqlTable(
  "kv_store",
  {
    rowId: serial("rowId").primaryKey(),
    k: varchar("k", { length: 40 }).notNull(),
    data: json("data").notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("uq_kv_k").on(t.k)],
);

/** Atomic per-prefix document number sequences, e.g. 'FBV-QUO-2026' -> 4. */
export const docSequences = mysqlTable(
  "doc_sequences",
  {
    rowId: serial("rowId").primaryKey(),
    prefix: varchar("prefix", { length: 30 }).notNull(),
    value: int("value").notNull().default(0),
  },
  (t) => [uniqueIndex("uq_seq_prefix").on(t.prefix)],
);
