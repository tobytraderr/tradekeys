import "server-only"

import { getDb, isDatabaseConfigured } from "@/lib/server/db"

export type TwinDetailCacheEntry<T> = {
  payload: T | null
  lastSuccessAt: string | null
  lastAttemptAt: string | null
  retryAfter: string | null
  failureCount: number
  lastError: string | null
}

export async function initTwinDetailCacheSchema() {
  // Schema is owned by SQL migrations.
}

export async function getTwinDetailCacheEntry<T>(
  twinId: string
): Promise<TwinDetailCacheEntry<T> | null> {
  if (!isDatabaseConfigured()) return null
  await initTwinDetailCacheSchema()
  const db = getDb()
  const result = await db.query(
    `
    select
      payload_json,
      last_success_at,
      last_attempt_at,
      retry_after,
      failure_count,
      last_error
    from twin_detail_snapshot_cache
    where twin_id = $1
    `,
    [twinId]
  )

  const row = result.rows[0]
  if (!row) return null

  return {
    payload: (row.payload_json as T | null) ?? null,
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

export async function setTwinDetailCachePayload<T>(twinId: string, payload: T) {
  if (!isDatabaseConfigured()) return
  await initTwinDetailCacheSchema()
  const db = getDb()
  await db.query(
    `
    insert into twin_detail_snapshot_cache (
      twin_id,
      payload_json,
      last_success_at,
      last_attempt_at,
      retry_after,
      failure_count,
      last_error,
      updated_at
    )
    values ($1, $2::jsonb, now(), now(), null, 0, null, now())
    on conflict (twin_id) do update set
      payload_json = excluded.payload_json,
      last_success_at = excluded.last_success_at,
      last_attempt_at = excluded.last_attempt_at,
      retry_after = null,
      failure_count = 0,
      last_error = null,
      updated_at = now()
    `,
    [twinId, JSON.stringify(payload)]
  )
}

export async function setTwinDetailCacheFailure(input: {
  twinId: string
  error: string
  retryAfter: Date
}) {
  if (!isDatabaseConfigured()) return
  await initTwinDetailCacheSchema()
  const db = getDb()
  await db.query(
    `
    insert into twin_detail_snapshot_cache (
      twin_id,
      payload_json,
      last_attempt_at,
      retry_after,
      failure_count,
      last_error,
      updated_at
    )
    values ($1, null, now(), $2, 1, $3, now())
    on conflict (twin_id) do update set
      last_attempt_at = now(),
      retry_after = excluded.retry_after,
      failure_count = least(twin_detail_snapshot_cache.failure_count + 1, 8),
      last_error = excluded.last_error,
      updated_at = now()
    `,
    [input.twinId, input.retryAfter.toISOString(), input.error]
  )
}
