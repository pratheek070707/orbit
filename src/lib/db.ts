import { Pool } from "pg";
declare global { var mapperPool: Pool | undefined; }
export const db = global.mapperPool ?? new Pool({ connectionString: process.env.DATABASE_URL, max: 12, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, ssl: process.env.NODE_ENV === "production" ? true : undefined });
if (process.env.NODE_ENV !== "production") global.mapperPool = db;
