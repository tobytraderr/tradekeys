import "server-only"

import type { PoolClient } from "pg"
import { getDb, isDatabaseConfigured } from "@/lib/server/db"

const BNB_USD_CACHE_KEY = "bnb-usd"

export type BnbUsdPriceCacheEntry = {
  priceUsd: number | null
  lastSuccessAt: string | null
  lastAttemptAt: string | null
  retryAfter: string | null
  failureCount: number
  lastError: string | null
}

export async function initBnbUsdPriceCacheSchema() {
  // Schema is owned by SQL migrations.
}

export async function getBnbUsdPriceCacheEntry(): Promise<BnbUsdPriceCacheEntry | null> {
  if (!isDatabaseConfigured()) return null

  await initBnbUsdPriceCacheSchema()
  const db = getDb()
  const result = await db.query(
    `
    select
      price_usd,
      last_success_at,
      last_attempt_at,
      retry_after,
      failure_count,
      last_error
    from bnb_usd_price_cache
    where cache_key = $1
    `,
    [BNB_USD_CACHE_KEY]
  )

  const row = result.rows[0]
  if (!row) return null

  return {
    priceUsd:
      row.price_usd === null || row.price_usd === undefined ? null : Number(row.price_usd),
    lastSuccessAt: row.last_success_at ? new Date(row.last_success_at).toISOString() : null,
    lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at).toISOString() : null,
    retryAfter: row.retry_after ? new Date(row.retry_after).toISOString() : null,
    failureCount:
      typeof row.failure_count === "number" ? row.failure_count : Number(row.failure_count ?? 0),
    lastError: row.last_error ? String(row.last_error) : null,
  }
}

export async function setBnbUsdPriceCacheSuccess(input: {
  priceUsd: number
  fetchedAt?: Date
}) {
  if (!isDatabaseConfigured()) return

  await initBnbUsdPriceCacheSchema()
  const db = getDb()
  const fetchedAt = input.fetchedAt ?? new Date()

  await db.query(
    `
    insert into bnb_usd_price_cache (
      cache_key,
      price_usd,
      last_success_at,
      last_attempt_at,
      retry_after,
      failure_count,
      last_error,
      updated_at
    )
    values ($1, $2, $3, $3, null, 0, null, now())
    on conflict (cache_key) do update set
      price_usd = excluded.price_usd,
      last_success_at = excluded.last_success_at,
      last_attempt_at = excluded.last_attempt_at,
      retry_after = null,
      failure_count = 0,
      last_error = null,
      updated_at = now()
    `,
    [BNB_USD_CACHE_KEY, input.priceUsd, fetchedAt.toISOString()]
  )
}

export async function setBnbUsdPriceCacheFailure(input: {
  error: string
  retryAfter: Date
}) {
  if (!isDatabaseConfigured()) return

  await initBnbUsdPriceCacheSchema()
  const db = getDb()
  await db.query(
    `
    insert into bnb_usd_price_cache (
      cache_key,
      price_usd,
      last_attempt_at,
      retry_after,
      failure_count,
      last_error,
      updated_at
    )
    values ($1, null, now(), $2, 1, $3, now())
    on conflict (cache_key) do update set
      last_attempt_at = now(),
      retry_after = excluded.retry_after,
      failure_count = least(bnb_usd_price_cache.failure_count + 1, 8),
      last_error = excluded.last_error,
      updated_at = now()
    `,
    [BNB_USD_CACHE_KEY, input.retryAfter.toISOString(), input.error]
  )
}

export async function withBnbUsdPriceRefreshLock<T>(
  task: () => Promise<T>
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  if (!isDatabaseConfigured()) {
    return { acquired: false }
  }

  await initBnbUsdPriceCacheSchema()
  const client = await getDb().connect()

  try {
    const lockResult = await client.query<{ locked: boolean }>(
      `select pg_try_advisory_lock(hashtext($1)) as locked`,
      [BNB_USD_CACHE_KEY]
    )
    const locked = Boolean(lockResult.rows[0]?.locked)
    if (!locked) {
      return { acquired: false }
    }

    try {
      return {
        acquired: true,
        value: await task(),
      }
    } finally {
      await unlockBnbUsdPriceRefresh(client).catch(() => undefined)
    }
  } finally {
    client.release()
  }
}

async function unlockBnbUsdPriceRefresh(client: PoolClient) {
  await client.query(`select pg_advisory_unlock(hashtext($1))`, [BNB_USD_CACHE_KEY])
}
