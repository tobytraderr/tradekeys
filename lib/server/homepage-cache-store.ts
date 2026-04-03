import "server-only"

import { getDb, isDatabaseConfigured } from "@/lib/server/db"

const HOMEPAGE_CACHE_KEY = "homepage-market"

export type HomepageCacheEntry<T> = {
  snapshot: T | null
  lastSuccessAt: string | null
  lastAttemptAt: string | null
  retryAfter: string | null
  failureCount: number
  lastError: string | null
}

export async function initHomepageCacheSchema() {
  // Schema is owned by SQL migrations.
}

export async function getHomepageCacheEntry<T>(): Promise<HomepageCacheEntry<T> | null> {
  if (!isDatabaseConfigured()) return null
  await initHomepageCacheSchema()
  const db = getDb()
  const result = await db.query(
    `
    select
      snapshot_json,
      last_success_at,
      last_attempt_at,
      retry_after,
      failure_count,
      last_error
    from homepage_snapshot_cache
    where cache_key = $1
    `,
    [HOMEPAGE_CACHE_KEY]
  )

  const row = result.rows[0]
  if (!row) return null

  return {
    snapshot: (row.snapshot_json as T | null) ?? null,
    lastSuccessAt: row.last_success_at ? new Date(row.last_success_at).toISOString() : null,
    lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at).toISOString() : null,
    retryAfter: row.retry_after ? new Date(row.retry_after).toISOString() : null,
    failureCount:
      typeof row.failure_count === "number"
        ? row.failure_count
        : Number(row.failure_count ?? 0),
    lastError: row.last_error ? String(row.last_error) : null,
  }
}

export async function setHomepageCacheSnapshot<T>(snapshot: T) {
  if (!isDatabaseConfigured()) return
  await initHomepageCacheSchema()
  const db = getDb()
  await db.query(
    `
    insert into homepage_snapshot_cache (
      cache_key,
      snapshot_json,
      last_success_at,
      last_attempt_at,
      retry_after,
      failure_count,
      last_error,
      updated_at
    )
    values ($1, $2::jsonb, now(), now(), null, 0, null, now())
    on conflict (cache_key) do update set
      snapshot_json = excluded.snapshot_json,
      last_success_at = excluded.last_success_at,
      last_attempt_at = excluded.last_attempt_at,
      retry_after = null,
      failure_count = 0,
      last_error = null,
      updated_at = now()
    `,
    [HOMEPAGE_CACHE_KEY, JSON.stringify(snapshot)]
  )
}

export async function setHomepageCacheFailure(input: {
  error: string
  retryAfter: Date
}) {
  if (!isDatabaseConfigured()) return
  await initHomepageCacheSchema()
  const db = getDb()
  await db.query(
    `
    insert into homepage_snapshot_cache (
      cache_key,
      snapshot_json,
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
      failure_count = least(homepage_snapshot_cache.failure_count + 1, 8),
      last_error = excluded.last_error,
      updated_at = now()
    `,
    [HOMEPAGE_CACHE_KEY, input.retryAfter.toISOString(), input.error]
  )
}
