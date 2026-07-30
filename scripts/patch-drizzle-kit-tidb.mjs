/**
 * TiDB compatibility patches for drizzle-kit push (drizzle-kit@0.31.x).
 *
 * drizzle-kit's MySQL introspection was written against real MySQL's
 * information_schema behavior. TiDB differs in three observable ways, and
 * each breaks `drizzle-kit push` idempotency:
 *
 *  1. PK introspection casing — drizzle-kit selects
 *     `table_name, column_name, ordinal_position` (lowercase) from
 *     information_schema.table_constraints, then reads row["TABLE_NAME"] /
 *     row["COLUMN_NAME"] (uppercase). Real MySQL always returns uppercase
 *     labels; TiDB echoes the SELECT-list case, so the reads yield undefined,
 *     drizzle-kit believes NO table has a primary key, and every push
 *     regenerates `ALTER TABLE <t> ADD PRIMARY KEY(...)`
 *     → ER_MULTIPLE_PRI_KEY (1068).
 *
 *  2. STATISTICS.NON_UNIQUE type — real MySQL returns integer 0/1 and
 *     drizzle-kit tests `=== 0`; TiDB returns the string "0"/"1", so unique
 *     indexes are misclassified as non-unique. Every push then generates
 *     DROP INDEX + ADD CONSTRAINT for every unique index.
 *
 *  3. Timestamp default detection — real MySQL marks expression defaults
 *     with EXTRA='DEFAULT_GENERATED'; TiDB leaves EXTRA empty for
 *     DEFAULT CURRENT_TIMESTAMP columns, so drizzle-kit treats the default
 *     as the string literal 'CURRENT_TIMESTAMP' and regenerates
 *     `MODIFY COLUMN ... DEFAULT (now())` on every push.
 *
 * This script patches node_modules/drizzle-kit/bin.cjs accordingly. It is
 * idempotent (per-patch markers) and runs automatically before db:push.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const target = join(root, "node_modules", "drizzle-kit", "bin.cjs");

/** Each patch: marker (idempotency), from → to, replaceAll flag. */
const PATCHES = [
  {
    name: "tidb-pk-case-fix",
    from: `        const tableName = tableToPkRow["TABLE_NAME"];
        const columnName = tableToPkRow["COLUMN_NAME"];`,
    to: `/* tidb-pk-case-fix */
        const tableName = tableToPkRow["TABLE_NAME"] ?? tableToPkRow["table_name"];
        const columnName = tableToPkRow["COLUMN_NAME"] ?? tableToPkRow["column_name"];`,
  },
  {
    name: "tidb-nonunique-type-fix",
    // Appears in the mysql + singlestore serializers; both are safe to patch
    // (Number(0) === 0 behaves identically for real-MySQL numeric values).
    from: `const isUnique = idxRow["NON_UNIQUE"] === 0;`,
    to: `const isUnique = Number(idxRow["NON_UNIQUE"]) === 0; /* tidb-nonunique-type-fix */`,
    replaceAll: true,
  },
  {
    name: "tidb-serial-unique-type-fix",
    // Same NON_UNIQUE type issue in the serial-column detection filter.
    from: `it["NON_UNIQUE"] === 0`,
    to: `Number(it["NON_UNIQUE"]) === 0 /* tidb-serial-unique-type-fix */`,
    replaceAll: true,
  },
  {
    name: "tidb-default-expr-fix",
    // Only for temporal columns, and only for values that are unambiguously
    // expression defaults — string-literal defaults like 'now()' are not
    // affected. On real MySQL these columns carry DEFAULT_GENERATED anyway,
    // so behavior there is unchanged.
    from: `isDefaultAnExpression = column11["EXTRA"].includes("DEFAULT_GENERATED");`,
    to: `isDefaultAnExpression = column11["EXTRA"].includes("DEFAULT_GENERATED") || /* tidb-default-expr-fix */ (/^(timestamp|datetime)$/i.test(column11["DATA_TYPE"]) && typeof column11["COLUMN_DEFAULT"] === "string" && /^(current_timestamp|now|localtime|localtimestamp)(\\(\\d*\\))?$/i.test(column11["COLUMN_DEFAULT"]));`,
    replaceAll: true,
  },
  {
    name: "tidb-now-default-normalize",
    // drizzle serializes timestamp().defaultNow() as the snapshot string
    // "(now())", but introspection renders the DB's CURRENT_TIMESTAMP default
    // as "(CURRENT_TIMESTAMP)" — the push diff compares the strings literally
    // and regenerates MODIFY COLUMN ... DEFAULT (now()) forever. Normalize
    // CURRENT_TIMESTAMP to drizzle's own "(now())" form. Patches only the
    // first (mysql-serializer) clearDefaults; the string occurs twice.
    from: `  } else {
    return \`(\${resultDefault})\`;
  }
}`,
    to: `  } else {
    /* tidb-now-default-normalize */
    return /^current_timestamp(\\(\\d*\\))?$/i.test(resultDefault) ? "(now())" : \`(\${resultDefault})\`;
  }
}`,
  },
];

if (!existsSync(target)) {
  console.warn(`[patch-drizzle-kit-tidb] ${target} not found — skipping (drizzle-kit not installed?)`);
  process.exit(0);
}

let src = readFileSync(target, "utf8");
let applied = 0;
for (const p of PATCHES) {
  const marker = `/* ${p.name} */`;
  if (src.includes(marker)) continue; // already applied
  if (!src.includes(p.from)) {
    console.warn(
      `[patch-drizzle-kit-tidb] '${p.name}': target block not found — drizzle-kit version may ` +
        "have changed; skipping. If db:push churns or fails with ER_MULTIPLE_PRI_KEY (1068) " +
        "on TiDB, re-check this patch.",
    );
    continue;
  }
  src = p.replaceAll ? src.split(p.from).join(p.to) : src.replace(p.from, p.to);
  applied += 1;
  console.log(`[patch-drizzle-kit-tidb] applied '${p.name}'`);
}

if (applied > 0) writeFileSync(target, src);
if (applied === 0) console.log("[patch-drizzle-kit-tidb] already applied");
