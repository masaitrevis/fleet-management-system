/**
 * Build mysql2 connection options from DATABASE_URL with automatic TLS.
 *
 * TiDB Cloud Serverless prohibits insecure transport, so TLS is enabled by
 * default. It is skipped for private-network / local endpoints (e.g. the
 * platform-provisioned PrivateLink database, localhost) and can be forced off
 * with `?tls=false` in the URL.
 */
export interface DbConnectionOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: { rejectUnauthorized: boolean };
}

export function dbConnectionOptions(databaseUrl: string): DbConnectionOptions {
  const u = new URL(databaseUrl);
  const host = u.hostname;
  const skipTls =
    u.searchParams.get("tls") === "false" ||
    /privatelink|localhost|127\.0\.0\.1|\.internal$/i.test(host);

  return {
    host,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    ...(skipTls ? {} : { ssl: { rejectUnauthorized: true } }),
  };
}
