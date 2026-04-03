import "server-only"

import type { PoolClient } from "pg"
import { getDb, isDatabaseConfigured } from "@/lib/server/db"
import type { TwinMetadata, TwinSummary } from "@/lib/types"

type CatalogTwinInput = {
  twinId: string
  owner: string
  metadataUrl?: string
  supply: number
  priceEth: number
  volumeEth: number
  totalTrades: number
  marketCapEth: number
  holders?: number
  change24hPct?: number
  sourceUpdatedAt?: string
  rawPayload: unknown
  candles?: Array<{
    bucketStart: string
    open: number
    high: number
    low: number
    close: number
    volumeEth: number
    volumeShares: number
    rawPayload: unknown
  }>
}

function rowsToTwinSummary(row: Record<string, unknown>): TwinSummary {
  const totalVolumeEth = Number(row.volume_eth ?? 0)
  return {
    id: String(row.twin_id),
    displayName: row.name ? String(row.name) : String(row.twin_id).slice(0, 10),
    owner: String(row.owner ?? "Unclaimed"),
    metadataUrl: row.metadata_url ? String(row.metadata_url) : undefined,
    avatarUrl: row.image_url ? String(row.image_url) : undefined,
    description: row.description ? String(row.description) : undefined,
    supply: Number(row.supply ?? 0),
    holders: Number(row.holders ?? 0),
    totalTrades: Number(row.total_trades ?? 0),
    totalVolumeEth,
    totalVolumeUsd: 0,
    volume24hEth: totalVolumeEth,
    volume24hUsd: 0,
    volume1hEth: 0,
    volume1hUsd: 0,
    lastPriceEth: Number(row.price_eth ?? 0),
    lastPriceUsd: 0,
    change1hPct: Number(row.change_24h_pct ?? 0),
    ageLabel: "0m",
  }
}

function rowToMetadata(row: Record<string, unknown>): TwinMetadata {
  return {
    twinId: String(row.twin_id),
    url: String(row.metadata_url),
    fetchedAt: new Date(row.fetched_at ? String(row.fetched_at) : Date.now()).toISOString(),
    payloadHash: String(row.payload_hash),
    name: row.name ? String(row.name) : undefined,
    description: row.description ? String(row.description) : undefined,
    imageUrl: row.image_url ? String(row.image_url) : undefined,
    links:
      row.links && typeof row.links === "object" ? (row.links as Record<string, string>) : undefined,
    starterQuestions: Array.isArray(row.starter_questions)
      ? row.starter_questions.map((item) => String(item))
      : undefined,
    rawPayload: row.raw_payload,
  }
}

export async function initCatalogSchema() {
  // Schema is owned by SQL migrations.
}

export async function createSyncRun(source: string, mode: string, details?: unknown) {
  if (!isDatabaseConfigured()) return null
  const db = getDb()
  const result = await db.query(
    `insert into sync_runs (source, mode, status, details) values ($1, $2, 'running', $3::jsonb) returning id`,
    [source, mode, JSON.stringify(details ?? null)]
  )
  return Number(result.rows[0]?.id ?? 0)
}

export async function finishSyncRun(id: number | null, status: "success" | "failed", details?: unknown) {
  if (!id || !isDatabaseConfigured()) return
  const db = getDb()
  await db.query(
    `update sync_runs set status = $2, details = $3::jsonb, completed_at = now() where id = $1`,
    [id, status, JSON.stringify(details ?? null)]
  )
}

async function upsertTwin(client: PoolClient, twin: CatalogTwinInput) {
  await client.query(
    `
    insert into twins (
      twin_id, owner, metadata_url, supply, price_eth, volume_eth, total_trades,
      market_cap_eth, holders, change_24h_pct, source_updated_at, raw_payload, updated_at
    ) values (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11, $12::jsonb, now()
    )
    on conflict (twin_id) do update set
      owner = excluded.owner,
      metadata_url = excluded.metadata_url,
      supply = excluded.supply,
      price_eth = excluded.price_eth,
      volume_eth = excluded.volume_eth,
      total_trades = excluded.total_trades,
      market_cap_eth = excluded.market_cap_eth,
      holders = excluded.holders,
      change_24h_pct = excluded.change_24h_pct,
      source_updated_at = excluded.source_updated_at,
      raw_payload = excluded.raw_payload,
      updated_at = now()
    `,
    [
      twin.twinId,
      twin.owner,
      twin.metadataUrl ?? null,
      twin.supply,
      twin.priceEth,
      twin.volumeEth,
      twin.totalTrades,
      twin.marketCapEth,
      twin.holders ?? 0,
      twin.change24hPct ?? 0,
      twin.sourceUpdatedAt ?? null,
      JSON.stringify(twin.rawPayload),
    ]
  )

  for (const candle of twin.candles ?? []) {
    await client.query(
      `
      insert into twin_candles (
        twin_id, bucket_start, open, high, low, close, volume_eth, volume_shares, raw_payload, updated_at
      ) values (
        $1, to_timestamp($2::double precision), $3, $4, $5, $6, $7, $8, $9::jsonb, now()
      )
      on conflict (twin_id, bucket_start) do update set
        open = excluded.open,
        high = excluded.high,
        low = excluded.low,
        close = excluded.close,
        volume_eth = excluded.volume_eth,
        volume_shares = excluded.volume_shares,
        raw_payload = excluded.raw_payload,
        updated_at = now()
      `,
      [
        twin.twinId,
        Number(candle.bucketStart),
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.volumeEth,
        candle.volumeShares,
        JSON.stringify(candle.rawPayload),
      ]
    )
  }
}

export async function upsertCatalogTwins(twins: CatalogTwinInput[]) {
  if (!isDatabaseConfigured() || twins.length === 0) return
  await initCatalogSchema()
  const db = getDb()
  const client = await db.connect()
  try {
    await client.query("begin")
    for (const twin of twins) {
      await upsertTwin(client, twin)
    }
    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

export async function upsertTwinMetadata(metadata: TwinMetadata[]) {
  if (!isDatabaseConfigured() || metadata.length === 0) return
  await initCatalogSchema()
  const db = getDb()
  for (const item of metadata) {
    await db.query(
      `
      insert into twin_metadata (
        twin_id, metadata_url, name, description, image_url, links,
        starter_questions, payload_hash, raw_payload, fetched_at, updated_at
      ) values (
        $1, $2, $3, $4, $5, $6::jsonb,
        $7::jsonb, $8, $9::jsonb, $10::timestamptz, now()
      )
      on conflict (twin_id) do update set
        metadata_url = excluded.metadata_url,
        name = excluded.name,
        description = excluded.description,
        image_url = excluded.image_url,
        links = excluded.links,
        starter_questions = excluded.starter_questions,
        payload_hash = excluded.payload_hash,
        raw_payload = excluded.raw_payload,
        fetched_at = excluded.fetched_at,
        updated_at = now()
      `,
      [
        item.twinId,
        item.url,
        item.name ?? null,
        item.description ?? null,
        item.imageUrl ?? null,
        JSON.stringify(item.links ?? null),
        JSON.stringify(item.starterQuestions ?? null),
        item.payloadHash,
        JSON.stringify(item.rawPayload),
        item.fetchedAt,
      ]
    )
  }
}

export async function listTrendingTwins(limit = 6): Promise<TwinSummary[]> {
  if (!isDatabaseConfigured()) return []
  await initCatalogSchema()
  const db = getDb()
  const result = await db.query(
    `
    select t.*, m.name, m.description, m.image_url
    from twins t
    left join twin_metadata m on m.twin_id = t.twin_id
    where t.supply > 0
    order by t.volume_eth desc, t.total_trades desc
    limit $1
    `,
    [limit]
  )
  return result.rows.map(rowsToTwinSummary)
}

export async function countCatalogTwins(): Promise<number> {
  if (!isDatabaseConfigured()) return 0
  await initCatalogSchema()
  const db = getDb()
  const result = await db.query(`select count(*)::int as count from twins`)
  return Number(result.rows[0]?.count ?? 0)
}

export async function listNewTwins(limit = 6): Promise<TwinSummary[]> {
  if (!isDatabaseConfigured()) return []
  await initCatalogSchema()
  const db = getDb()
  const result = await db.query(
    `
    select t.*, m.name, m.description, m.image_url
    from twins t
    left join twin_metadata m on m.twin_id = t.twin_id
    where t.supply > 0
    order by coalesce(t.source_updated_at, t.created_at) desc
    limit $1
    `,
    [limit]
  )
  return result.rows.map(rowsToTwinSummary)
}

export async function listActiveTwins(limit = 3): Promise<TwinSummary[]> {
  if (!isDatabaseConfigured()) return []
  await initCatalogSchema()
  const db = getDb()
  const result = await db.query(
    `
    select t.*, m.name, m.description, m.image_url
    from twins t
    left join twin_metadata m on m.twin_id = t.twin_id
    where t.total_trades > 0
    order by t.updated_at desc, t.total_trades desc
    limit $1
    `,
    [limit]
  )
  return result.rows.map(rowsToTwinSummary)
}

export async function getTwinFromCatalog(id: string): Promise<TwinSummary | null> {
  if (!isDatabaseConfigured()) return null
  await initCatalogSchema()
  const db = getDb()
  const result = await db.query(
    `
    select t.*, m.name, m.description, m.image_url
    from twins t
    left join twin_metadata m on m.twin_id = t.twin_id
    where t.twin_id = $1
    limit 1
    `,
    [id]
  )
  return result.rows[0] ? rowsToTwinSummary(result.rows[0]) : null
}

export async function searchCatalogTwins(query: string, limit = 8): Promise<TwinSummary[]> {
  if (!isDatabaseConfigured()) return []

  const normalized = query.trim()
  if (!normalized) return []

  await initCatalogSchema()
  const db = getDb()
  const exact = normalized.toLowerCase()
  const prefix = `${normalized}%`
  const contains = `%${normalized}%`

  const result = await db.query(
    `
    select t.*, m.name, m.description, m.image_url
    from twins t
    left join twin_metadata m on m.twin_id = t.twin_id
    where
      t.twin_id ilike $3
      or coalesce(m.name, '') ilike $3
      or coalesce(m.description, '') ilike $3
    order by
      case
        when lower(coalesce(m.name, '')) = $1 then 400
        when lower(t.twin_id) = $1 then 380
        when lower(coalesce(m.name, '')) like lower($2) then 320
        when lower(t.twin_id) like lower($2) then 300
        when lower(coalesce(m.description, '')) like lower($2) then 180
        else 100
      end desc,
      t.volume_eth desc,
      t.total_trades desc,
      t.updated_at desc
    limit $4
    `,
    [exact, prefix, contains, limit]
  )

  return result.rows.map(rowsToTwinSummary)
}

export async function getCatalogMetadataMap(twinIds: string[]) {
  if (!isDatabaseConfigured() || twinIds.length === 0) {
    return {} as Record<string, TwinMetadata>
  }
  await initCatalogSchema()
  const db = getDb()
  const result = await db.query(
    `
    select twin_id, metadata_url, name, description, image_url, links, starter_questions, payload_hash, raw_payload, fetched_at
    from twin_metadata
    where twin_id = any($1::text[])
    `,
    [twinIds]
  )

  return Object.fromEntries(
    result.rows.map((row) => [String(row.twin_id), rowToMetadata(row)])
  ) as Record<string, TwinMetadata>
}

export async function getCatalogMetadata(twinId: string) {
  const map = await getCatalogMetadataMap([twinId])
  return map[twinId] ?? null
}
