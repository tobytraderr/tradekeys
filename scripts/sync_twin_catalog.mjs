import fs from "node:fs/promises"
import path from "node:path"
import pg from "pg"
import { loadDotEnv } from "./load-env.mjs"

loadDotEnv()

const { Pool } = pg

const DATABASE_URL = process.env.DATABASE_URL
const SUBGRAPH_URL = process.env.SUBGRAPH_URL
const INDEXER_URL = process.env.TWINFUN_INDEXER_URL || "https://twinindexer.memchat.io/subgraphs/name/digital"
const ALLOW_BROWSER_CAPTURE_FALLBACK =
  ["1", "true", "yes", "on"].includes((process.env.ALLOW_BROWSER_CAPTURE_FALLBACK || "").trim().toLowerCase())
const OUT_DIR = path.join(process.cwd(), "data")
const CAPTURE_FILE = path.join(OUT_DIR, "twinfun-browser-capture.json")
const FETCH_TIMEOUT_MS = 10000
const FETCH_RETRY_ATTEMPTS = 3
const FETCH_RETRY_BASE_MS = 500

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required.")
  process.exit(1)
}

const QUERY = `
query GetAllTwins {
  digitalTwins(first: 1000, where: { currentSupply_gt: "0" }) {
    id
    owner
    url
    currentSupply
    marketPrice
    totalVolumeETH
    totalTrades
    marketCap
    dailyCandles(orderBy: timestamp, orderDirection: desc, first: 2) {
      id
      timestamp
      open
      high
      low
      close
      volumeETH
      volumeShares
      __typename
    }
    __typename
  }
}
`

function toNumber(value) {
  if (value == null) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithRetry(input, init, options = {}) {
  const attempts = Math.max(1, options.attempts ?? FETCH_RETRY_ATTEMPTS)
  const timeoutMs = Math.max(1000, options.timeoutMs ?? FETCH_TIMEOUT_MS)
  let lastError = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(input, {
        ...init,
        signal: controller.signal,
      })

      if (response.ok || attempt === attempts || (response.status !== 429 && response.status < 500)) {
        return response
      }

      lastError = new Error(`Request failed with status ${response.status}`)
    } catch (error) {
      lastError = error
      if (attempt === attempts) {
        throw error
      }
    } finally {
      clearTimeout(timeout)
    }

    await sleep(Math.min(FETCH_RETRY_BASE_MS * 2 ** (attempt - 1), 4000))
  }

  throw lastError instanceof Error ? lastError : new Error("Request failed.")
}

async function queryIndexer() {
  const response = await fetchWithRetry(INDEXER_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/graphql-response+json,application/json;q=0.9",
    },
    body: JSON.stringify({
      operationName: "GetAllTwins",
      variables: {},
      query: QUERY,
      extensions: { clientLibrary: { name: "@apollo/client", version: "4.0.9" } },
    }),
  })

  if (!response.ok) {
    throw new Error(`Indexer request failed with status ${response.status}`)
  }

  return response.json()
}

async function loadBrowserCapture() {
  const raw = await fs.readFile(CAPTURE_FILE, "utf8")
  return JSON.parse(raw)
}

async function fetchMetadata(url) {
  if (!url) return null
  const response = await fetchWithRetry(url, {
    method: "GET",
    cache: "no-store",
  })
  if (!response.ok) return null
  return response.json()
}

async function initSchema(pool) {
  void pool
}

async function main() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
  })

  await initSchema(pool)

  let source = "indexer"
  let payload

  try {
    payload = await queryIndexer()
  } catch (error) {
    if (!ALLOW_BROWSER_CAPTURE_FALLBACK) {
      throw new Error(
        `Indexer request failed and browser-capture fallback is disabled. Set ALLOW_BROWSER_CAPTURE_FALLBACK=true only for local/manual recovery. Original error: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }

    source = "browser-capture"
    payload = await loadBrowserCapture()
    payload = payload.responseBody
    console.warn(
      `Direct indexer call failed, using ${CAPTURE_FILE}: ${error instanceof Error ? error.message : error}`
    )
  }

  const twins = payload?.data?.digitalTwins ?? []
  if (!Array.isArray(twins)) {
    throw new Error("No digitalTwins array found in payload.")
  }

  const syncRun = await pool.query(
    `insert into sync_runs (source, mode, status, details) values ($1, 'catalog-sync', 'running', $2::jsonb) returning id`,
    [source, JSON.stringify({ twinCount: twins.length })]
  )
  const syncRunId = syncRun.rows[0]?.id

  try {
    for (const twin of twins) {
      await pool.query(
        `
        insert into twins (
          twin_id, owner, metadata_url, supply, price_eth, volume_eth, total_trades,
          market_cap_eth, holders, change_24h_pct, raw_payload, updated_at
        ) values (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11::jsonb, now()
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
          raw_payload = excluded.raw_payload,
          updated_at = now()
        `,
        [
          twin.id,
          twin.owner ?? "Unclaimed",
          twin.url ?? null,
          toNumber(twin.currentSupply),
          toNumber(twin.marketPrice),
          toNumber(twin.totalVolumeETH),
          Math.trunc(toNumber(twin.totalTrades)),
          toNumber(twin.marketCap),
          0,
          0,
          JSON.stringify(twin),
        ]
      )

      for (const candle of twin.dailyCandles ?? []) {
        await pool.query(
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
            twin.id,
            Number(candle.timestamp),
            toNumber(candle.open),
            toNumber(candle.high),
            toNumber(candle.low),
            toNumber(candle.close),
            toNumber(candle.volumeETH),
            toNumber(candle.volumeShares),
            JSON.stringify(candle),
          ]
        )
      }

      const metadata = await fetchMetadata(twin.url)
      if (metadata) {
        const payloadHash = JSON.stringify(metadata)
        await pool.query(
          `
          insert into twin_metadata (
            twin_id, metadata_url, name, description, image_url, links,
            starter_questions, payload_hash, raw_payload, fetched_at, updated_at
          ) values (
            $1, $2, $3, $4, $5, $6::jsonb,
            $7::jsonb, $8, $9::jsonb, now(), now()
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
            twin.id,
            twin.url,
            typeof metadata.name === "string" ? metadata.name : null,
            typeof metadata.description === "string" ? metadata.description : null,
            typeof metadata.image_url === "string" ? metadata.image_url : null,
            JSON.stringify(metadata.links ?? null),
            JSON.stringify(metadata.starter_questions ?? null),
            payloadHash,
            JSON.stringify(metadata),
          ]
        )
      }
    }

    await pool.query(
      `update sync_runs set status = 'success', completed_at = now(), details = $2::jsonb where id = $1`,
      [syncRunId, JSON.stringify({ source, twinCount: twins.length })]
    )
    console.log(`Synced ${twins.length} twins into Postgres via ${source}.`)
  } catch (error) {
    await pool.query(
      `update sync_runs set status = 'failed', completed_at = now(), details = $2::jsonb where id = $1`,
      [syncRunId, JSON.stringify({ source, error: error instanceof Error ? error.message : String(error) })]
    )
    throw error
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
