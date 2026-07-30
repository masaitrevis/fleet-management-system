import { drizzle } from "drizzle-orm/mysql2";
import { createPool } from "mysql2/promise";
import { env } from "../lib/env";
import * as schema from "@db/schema";
import { dbConnectionOptions } from "@db/connection-options";

function createDb() {
  const pool = createPool({
    ...dbConnectionOptions(env.databaseUrl),
    connectionLimit: 5,
    waitForConnections: true,
  });
  return drizzle(pool, { mode: "planetscale", schema });
}

let instance: ReturnType<typeof createDb> | undefined;

export function getDb() {
  if (!instance) {
    instance = createDb();
  }
  return instance;
}
