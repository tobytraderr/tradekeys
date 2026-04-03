import "server-only"

import { getDb, isDatabaseConfigured } from "@/lib/server/db"
import type {
  MarketHomepageSnapshotRecord,
  MarketTwinDetailSnapshotRecord,
} from "@/lib/services/market/contracts"

function rowToHomepageSnapshot(
  row: Record<string, unknown>
): MarketHomepageSnapshotRecord | null {
  if (!row.snapshot_json) {
    return null
  }

  return {
    version: Number(row.snapshot_version ?? 0) as MarketHomepageSnapshotRecord["version"],
    snapshotKey: String(row.snapshot_key),
    generatedAt: new Date(String(row.generated_at)).toISOString(),
    runtimeSource: String(row.runtime_source) as MarketHomepageSnapshotRecord["runtimeSource"],
    snapshot: row.snapshot_json as MarketHomepageSnapshotRecord["snapshot"],
  }
}

function rowToTwinDetailSnapshot(
  row: Record<string, unknown>
): MarketTwinDetailSnapshotRecord | null {
  if (!row.snapshot_json) {
    return null
  }

  return {
    version: Number(row.snapshot_version ?? 0) as MarketTwinDetailSnapshotRecord["version"],
    twinId: String(row.twin_id),
    generatedAt: new Date(String(row.generated_at)).toISOString(),
    runtimeSource: String(row.runtime_source) as MarketTwinDetailSnapshotRecord["runtimeSource"],
    snapshot: row.snapshot_json as MarketTwinDetailSnapshotRecord["snapshot"],
  }
}

export async function getStoredHomepageRuntimeSnapshot(snapshotKey: string) {
  if (!isDatabaseConfigured()) return null

  const db = getDb()
  const result = await db.query(
    `
    select
      snapshot_key,
      contract_version as snapshot_version,
      source as runtime_source,
      payload_json as snapshot_json,
      generated_at
    from market_runtime_snapshots
    where snapshot_key = $1
    limit 1
    `,
    [snapshotKey]
  )

  return result.rows[0] ? rowToHomepageSnapshot(result.rows[0]) : null
}

export async function setStoredHomepageRuntimeSnapshot(
  snapshotKey: string,
  record: MarketHomepageSnapshotRecord
) {
  if (!isDatabaseConfigured()) return

  const db = getDb()
  await db.query(
    `
    insert into market_runtime_snapshots (
      snapshot_key,
      contract_version,
      source,
      payload_json,
      generated_at,
      updated_at
    ) values (
      $1, $2, $3, $4::jsonb, $5::timestamptz, now()
    )
    on conflict (snapshot_key) do update set
      contract_version = excluded.contract_version,
      source = excluded.source,
      payload_json = excluded.payload_json,
      generated_at = excluded.generated_at,
      updated_at = now()
    `,
    [
      snapshotKey,
      record.version,
      record.runtimeSource,
      JSON.stringify(record.snapshot),
      record.generatedAt,
    ]
  )
}

export async function getStoredTwinDetailRuntimeSnapshot(twinId: string) {
  if (!isDatabaseConfigured()) return null

  const db = getDb()
  const result = await db.query(
    `
    select
      twin_id,
      contract_version as snapshot_version,
      source as runtime_source,
      payload_json as snapshot_json,
      generated_at
    from market_twin_detail_snapshots
    where twin_id = $1
    limit 1
    `,
    [twinId]
  )

  return result.rows[0] ? rowToTwinDetailSnapshot(result.rows[0]) : null
}

export async function setStoredTwinDetailRuntimeSnapshot(
  twinId: string,
  record: MarketTwinDetailSnapshotRecord
) {
  if (!isDatabaseConfigured()) return

  const db = getDb()
  await db.query(
    `
    insert into market_twin_detail_snapshots (
      twin_id,
      contract_version,
      source,
      payload_json,
      generated_at,
      updated_at
    ) values (
      $1, $2, $3, $4::jsonb, $5::timestamptz, now()
    )
    on conflict (twin_id) do update set
      contract_version = excluded.contract_version,
      source = excluded.source,
      payload_json = excluded.payload_json,
      generated_at = excluded.generated_at,
      updated_at = now()
    `,
    [
      twinId,
      record.version,
      record.runtimeSource,
      JSON.stringify(record.snapshot),
      record.generatedAt,
    ]
  )
}
