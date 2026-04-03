import "server-only"

import { Pool } from "pg"
import { getDatabaseUrl } from "@/lib/env"
import { recordDbError } from "@/lib/server/ops-observability"

let pool: Pool | null = null

export function isDatabaseConfigured() {
  return Boolean(getDatabaseUrl())
}

export function getDb() {
  const connectionString = getDatabaseUrl()
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.")
  }

  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 10,
      ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
    })
    pool.on("error", (error) => {
      recordDbError("pool", error)
    })
  }

  return pool
}
