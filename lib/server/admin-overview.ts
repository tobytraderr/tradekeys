import "server-only"

import { access, readFile, stat } from "node:fs/promises"
import path from "node:path"
import { ADMIN_PLANNED_ENDPOINTS, ADMIN_ROUTE_CATALOG } from "@/lib/admin-catalog"
import { getAdminUsernameHint, isAdminConfigured } from "@/lib/admin-auth"
import type {
  AdminArtifactSummary,
  AdminEnvEntry,
  AdminOverview,
  AdminSyncRunSummary,
  AdminTableSummary,
  AdminTraceEntry,
} from "@/lib/admin-types"
import {
  getAdminAllowedIps,
  getBscRpcUrl,
  getDatabaseUrl,
  getImageProxyAllowedHosts,
  getMarketDataRuntimeSource,
  getOpsAlertWindowMs,
  getOpsCacheRefreshFailureThreshold,
  getOpsDbErrorThreshold,
  getOpsQuoteFailureThreshold,
  getOpsRateLimitThreshold,
  getOpenGradientEndpoint,
  getOpenGradientModel,
  getPythonBin,
  getSubgraphUrl,
  getTwinFunIndexerUrl,
  isLegacyMarketDataFallbackEnabled,
} from "@/lib/env"
import { COPILOT_TRACE_FILE } from "@/lib/server/copilot-trace-log"
import { getDb, isDatabaseConfigured } from "@/lib/server/db"
import { getEnvValidation, getIncidentPlaybooks } from "@/lib/server/env-validation"
import { getFeaturedOverride } from "@/lib/server/featured-store"
import { getAdminHealthChecks } from "@/lib/server/ops-health"
import {
  getAlertSnapshots,
  getOpsMetricSnapshots,
  getRateLimitSnapshots,
  OPS_EVENT_LOG_FILE,
  readOpsEventTail,
  recordDbError,
} from "@/lib/server/ops-observability"
import { listCopilotPromptReviews } from "@/lib/server/copilot-review-store"

const DATA_DIR = path.join(process.cwd(), "data")
const FEATURED_OVERRIDE_FILE = path.join(DATA_DIR, "featured-override.json")
const TWIN_METADATA_CACHE_FILE = path.join(DATA_DIR, "twin-metadata-cache.json")
const BROWSER_CAPTURE_FILE = path.join(DATA_DIR, "twinfun-browser-capture.json")
const INCIDENT_PLAYBOOKS_FILE = path.join(process.cwd(), "docs", "incident-playbooks.md")

type TableDescriptor = {
  name: string
  label: string
  description: string
  updatedAtColumn?: string
}

const TABLES: TableDescriptor[] = [
  {
    name: "twins",
    label: "Twin catalog",
    description: "Indexed market twins stored for discovery and detail pages.",
    updatedAtColumn: "updated_at",
  },
  {
    name: "twin_metadata",
    label: "Twin metadata",
    description: "Resolved metadata payloads and starter questions per twin.",
    updatedAtColumn: "updated_at",
  },
  {
    name: "twin_candles",
    label: "Twin candles",
    description: "Indexed OHLCV candles for chart rendering.",
    updatedAtColumn: "updated_at",
  },
  {
    name: "sync_runs",
    label: "Sync runs",
    description: "Catalog ingestion run ledger.",
    updatedAtColumn: "started_at",
  },
  {
    name: "homepage_snapshot_cache",
    label: "Homepage cache",
    description: "Homepage fallback snapshot state and retry metadata.",
    updatedAtColumn: "updated_at",
  },
  {
    name: "twin_detail_snapshot_cache",
    label: "Twin detail cache",
    description: "Per-twin cached detail payloads and failure metadata.",
    updatedAtColumn: "updated_at",
  },
  {
    name: "market_runtime_snapshots",
    label: "Market runtime snapshots",
    description: "Versioned homepage/runtime market snapshots used by the ingestion-backed read path.",
    updatedAtColumn: "updated_at",
  },
  {
    name: "market_twin_detail_snapshots",
    label: "Market detail snapshots",
    description: "Versioned per-twin detail snapshots used by the ingestion-backed read path.",
    updatedAtColumn: "updated_at",
  },
  {
    name: "user_watchlists",
    label: "Watchlists",
    description: "Persisted wallet watchlist relationships.",
    updatedAtColumn: "updated_at",
  },
  {
    name: "user_trade_preferences",
    label: "Quick-buy settings",
    description: "Per-wallet quick-buy preferences.",
    updatedAtColumn: "updated_at",
  },
  {
    name: "user_alerts",
    label: "Alerts",
    description: "User-defined alert rules.",
    updatedAtColumn: "updated_at",
  },
  {
    name: "copilot_prompt_reviews",
    label: "Copilot reviews",
    description: "Copilot clarification/error review queue.",
    updatedAtColumn: "created_at",
  },
]

function formatMaskedUrl(value: string | undefined) {
  if (!value) {
    return undefined
  }

  try {
    const parsed = new URL(value)
    const databaseName = parsed.pathname.replace(/^\//, "")
    return `${parsed.protocol}//${parsed.hostname}${databaseName ? `/${databaseName}` : ""}`
  } catch {
    return value.slice(0, 32)
  }
}

function buildEnvEntries(): AdminEnvEntry[] {
  const rawDatabaseUrl = getDatabaseUrl()
  const rawSubgraphUrl = process.env.SUBGRAPH_URL?.trim() || undefined
  const rawIndexerUrl = process.env.TWINFUN_INDEXER_URL?.trim() || undefined
  const rawModel = process.env.OPENGRADIENT_MODEL?.trim() || undefined
  const rawPythonBin = process.env.PYTHON_BIN?.trim() || undefined
  const rawImageHosts = process.env.IMAGE_PROXY_ALLOWED_HOSTS?.trim() || undefined
  const rawMarketDataRuntimeSource = process.env.MARKET_DATA_RUNTIME_SOURCE?.trim() || undefined
  const rawMarketDataFallback = process.env.MARKET_DATA_LEGACY_FALLBACK_ENABLED?.trim() || undefined
  const rawOpsAlertWindow = process.env.OPS_ALERT_WINDOW_MS?.trim() || undefined
  const rawOpsRateLimitThreshold = process.env.OPS_RATE_LIMIT_THRESHOLD?.trim() || undefined
  const rawOpsCacheRefreshFailureThreshold = process.env.OPS_CACHE_REFRESH_FAILURE_THRESHOLD?.trim() || undefined
  const rawOpsDbErrorThreshold = process.env.OPS_DB_ERROR_THRESHOLD?.trim() || undefined
  const rawOpsQuoteFailureThreshold = process.env.OPS_QUOTE_FAILURE_THRESHOLD?.trim() || undefined

  return [
    {
      name: "ADMIN_USERNAME",
      category: "auth",
      configured: Boolean(process.env.ADMIN_USERNAME?.trim()),
      source: process.env.ADMIN_USERNAME?.trim() ? "env" : "missing",
      description: "Basic-auth username protecting /admin and /api/admin.",
      safeValue: getAdminUsernameHint() ?? undefined,
    },
    {
      name: "ADMIN_PASSWORD",
      category: "auth",
      configured: Boolean(process.env.ADMIN_PASSWORD?.trim()),
      source: process.env.ADMIN_PASSWORD?.trim() ? "env" : "missing",
      description: "Basic-auth password protecting /admin and /api/admin.",
      safeValue: process.env.ADMIN_PASSWORD?.trim() ? "configured" : undefined,
    },
    {
      name: "ADMIN_ACCESS_TOKEN",
      category: "auth",
      configured: Boolean(process.env.ADMIN_ACCESS_TOKEN?.trim()),
      source: process.env.ADMIN_ACCESS_TOKEN?.trim() ? "env" : "missing",
      description: "Optional second factor for admin access. When set, pass it once as ?admin_token=... to bootstrap the admin UI cookie.",
      safeValue: process.env.ADMIN_ACCESS_TOKEN?.trim() ? "configured" : undefined,
    },
    {
      name: "ADMIN_ALLOWED_IPS",
      category: "auth",
      configured: getAdminAllowedIps().length > 0,
      source: getAdminAllowedIps().length > 0 ? "env" : "missing",
      description: "Optional comma-separated IP allowlist for the admin surface.",
      safeValue: getAdminAllowedIps().length > 0 ? getAdminAllowedIps().join(", ") : undefined,
    },
    {
      name: "DATABASE_URL",
      category: "database",
      configured: Boolean(rawDatabaseUrl),
      source: rawDatabaseUrl ? "env" : "missing",
      description: "Postgres persistence for watchlists, alerts, cache tables, and review queues.",
      safeValue: formatMaskedUrl(rawDatabaseUrl),
    },
    {
      name: "SUBGRAPH_URL",
      category: "market-data",
      configured: Boolean(rawSubgraphUrl),
      source: rawSubgraphUrl ? "env" : "missing",
      description: "Primary subgraph endpoint when explicitly configured.",
      safeValue: formatMaskedUrl(getSubgraphUrl()),
    },
    {
      name: "TWINFUN_INDEXER_URL",
      category: "market-data",
      configured: true,
      source: rawIndexerUrl ? "env" : "default",
      description: "Twinfun indexer source used for catalog data.",
      safeValue: formatMaskedUrl(getTwinFunIndexerUrl()),
    },
    {
      name: "MARKET_DATA_RUNTIME_SOURCE",
      category: "market-data",
      configured: true,
      source: rawMarketDataRuntimeSource ? "env" : "default",
      description: "Controls the primary market-data runtime path during staged migration.",
      safeValue: getMarketDataRuntimeSource(),
    },
    {
      name: "MARKET_DATA_LEGACY_FALLBACK_ENABLED",
      category: "market-data",
      configured: true,
      source: rawMarketDataFallback ? "env" : "default",
      description: "Keeps legacy market-data reads available as a rollback/fallback path during cutover.",
      safeValue: String(isLegacyMarketDataFallbackEnabled()),
    },
    {
      name: "BSC_RPC_URL",
      category: "market-data",
      configured: Boolean(process.env.BSC_RPC_URL?.trim()),
      source: process.env.BSC_RPC_URL?.trim() ? "env" : "missing",
      description: "BNB Smart Chain RPC endpoint for live contract reads.",
      safeValue: formatMaskedUrl(getBscRpcUrl()),
    },
    {
      name: "IMAGE_PROXY_ALLOWED_HOSTS",
      category: "runtime",
      configured: true,
      source: rawImageHosts ? "env" : "default",
      description: "Host allowlist for the image proxy route.",
      safeValue: getImageProxyAllowedHosts().join(", "),
    },
    {
      name: "OPENGRADIENT_API_URL",
      category: "ai",
      configured: Boolean(process.env.OPENGRADIENT_API_URL?.trim()),
      source: process.env.OPENGRADIENT_API_URL?.trim() ? "env" : "missing",
      description: "OpenGradient endpoint for copilot orchestration.",
      safeValue: formatMaskedUrl(getOpenGradientEndpoint()),
    },
    {
      name: "OPENGRADIENT_API_KEY",
      category: "ai",
      configured: Boolean(process.env.OPENGRADIENT_API_KEY?.trim()),
      source: process.env.OPENGRADIENT_API_KEY?.trim() ? "env" : "missing",
      description: "OpenGradient API credential.",
      safeValue: process.env.OPENGRADIENT_API_KEY?.trim() ? "configured" : undefined,
    },
    {
      name: "OPENGRADIENT_PRIVATE_KEY",
      category: "ai",
      configured: Boolean(process.env.OPENGRADIENT_PRIVATE_KEY?.trim()),
      source: process.env.OPENGRADIENT_PRIVATE_KEY?.trim() ? "env" : "missing",
      description: "OpenGradient signer private key.",
      safeValue: process.env.OPENGRADIENT_PRIVATE_KEY?.trim() ? "configured" : undefined,
    },
    {
      name: "OPENGRADIENT_MODEL",
      category: "ai",
      configured: true,
      source: rawModel ? "env" : "default",
      description: "Copilot model selection.",
      safeValue: getOpenGradientModel(),
    },
    {
      name: "PYTHON_BIN",
      category: "runtime",
      configured: true,
      source: rawPythonBin ? "env" : "default",
      description: "Python interpreter used by local scripts and copilot integration.",
      safeValue: getPythonBin(),
    },
    {
      name: "OPS_ALERT_WINDOW_MS",
      category: "runtime",
      configured: true,
      source: rawOpsAlertWindow ? "env" : "default",
      description: "Rolling alert window used for rate-limit, cache-failure, DB-error, and quote-path thresholds.",
      safeValue: String(getOpsAlertWindowMs()),
    },
    {
      name: "OPS_RATE_LIMIT_THRESHOLD",
      category: "runtime",
      configured: true,
      source: rawOpsRateLimitThreshold ? "env" : "default",
      description: "Number of upstream 429s inside the alert window before a rate-limit alert becomes active.",
      safeValue: String(getOpsRateLimitThreshold()),
    },
    {
      name: "OPS_CACHE_REFRESH_FAILURE_THRESHOLD",
      category: "runtime",
      configured: true,
      source: rawOpsCacheRefreshFailureThreshold ? "env" : "default",
      description: "Cache refresh failures required before the cache alert becomes active.",
      safeValue: String(getOpsCacheRefreshFailureThreshold()),
    },
    {
      name: "OPS_DB_ERROR_THRESHOLD",
      category: "runtime",
      configured: true,
      source: rawOpsDbErrorThreshold ? "env" : "default",
      description: "Database errors required before the DB alert becomes active.",
      safeValue: String(getOpsDbErrorThreshold()),
    },
    {
      name: "OPS_QUOTE_FAILURE_THRESHOLD",
      category: "runtime",
      configured: true,
      source: rawOpsQuoteFailureThreshold ? "env" : "default",
      description: "Quote-path failures required before the quote alert becomes active.",
      safeValue: String(getOpsQuoteFailureThreshold()),
    },
  ]
}

async function safeAccess(filePath: string) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function readJsonPreview(filePath: string) {
  try {
    const raw = await readFile(filePath, "utf8")
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

async function getArtifactSummary(input: {
  label: string
  path: string
  description: string
  previewBuilder?: (value: unknown) => unknown
}): Promise<AdminArtifactSummary> {
  const exists = await safeAccess(input.path)
  if (!exists) {
    return {
      label: input.label,
      path: input.path,
      description: input.description,
      exists: false,
      sizeBytes: null,
      modifiedAt: null,
    }
  }

  const fileStat = await stat(input.path)
  const preview = input.previewBuilder ? input.previewBuilder(await readJsonPreview(input.path)) : undefined

  return {
    label: input.label,
    path: input.path,
    description: input.description,
    exists: true,
    sizeBytes: fileStat.size,
    modifiedAt: fileStat.mtime.toISOString(),
    ...(preview !== undefined ? { preview } : {}),
  }
}

async function listArtifacts() {
  return Promise.all([
    getArtifactSummary({
      label: "Featured override file",
      path: FEATURED_OVERRIDE_FILE,
      description: "File-backed homepage featured override.",
      previewBuilder(value) {
        if (!value || typeof value !== "object") {
          return undefined
        }

        return value
      },
    }),
    getArtifactSummary({
      label: "Twin metadata cache",
      path: TWIN_METADATA_CACHE_FILE,
      description: "Filesystem fallback cache for twin metadata responses.",
      previewBuilder(value) {
        if (!value || typeof value !== "object") {
          return undefined
        }

        const items = (value as { items?: Record<string, unknown> }).items
        return {
          itemCount: items ? Object.keys(items).length : 0,
        }
      },
    }),
    getArtifactSummary({
      label: "Browser capture snapshot",
      path: BROWSER_CAPTURE_FILE,
      description: "Collected browser scrape payload used during data sync work.",
      previewBuilder(value) {
        if (!value || typeof value !== "object") {
          return undefined
        }

        return {
          topLevelKeys: Object.keys(value as Record<string, unknown>).slice(0, 12),
        }
      },
    }),
    getArtifactSummary({
      label: "Copilot trace log",
      path: COPILOT_TRACE_FILE,
      description: "Structured NDJSON trace emitted by the copilot route.",
    }),
    getArtifactSummary({
      label: "Ops event log",
      path: OPS_EVENT_LOG_FILE,
      description: "Structured NDJSON operational events for upstream failures, cache behavior, alerts, and client telemetry.",
    }),
    getArtifactSummary({
      label: "Incident playbooks",
      path: INCIDENT_PLAYBOOKS_FILE,
      description: "Documented incident response playbooks for the main dependency failure modes.",
    }),
  ])
}

async function listTableSummaries(): Promise<AdminTableSummary[]> {
  if (!isDatabaseConfigured()) {
    return TABLES.map((table) => ({
      name: table.name,
      label: table.label,
      description: table.description,
      exists: false,
      rowCount: null,
      lastUpdatedAt: null,
    }))
  }

  const db = getDb()
  const summaries = await Promise.all(
    TABLES.map(async (table) => {
      try {
        const existsResult = await db.query<{ regclass: string | null }>(
          "select to_regclass($1) as regclass",
          [table.name]
        )
        const exists = Boolean(existsResult.rows[0]?.regclass)
        if (!exists) {
          return {
            name: table.name,
            label: table.label,
            description: table.description,
            exists: false,
            rowCount: null,
            lastUpdatedAt: null,
          }
        }

        const result = await db.query<{ count: number; updated_at: Date | string | null }>(
          table.updatedAtColumn
            ? `select count(*)::int as count, max(${table.updatedAtColumn}) as updated_at from ${table.name}`
            : `select count(*)::int as count from ${table.name}`
        )

        return {
          name: table.name,
          label: table.label,
          description: table.description,
          exists: true,
          rowCount: Number(result.rows[0]?.count ?? 0),
          lastUpdatedAt: result.rows[0]?.updated_at
            ? new Date(result.rows[0].updated_at).toISOString()
            : null,
        }
      } catch (error) {
        recordDbError(`admin_table_summary_${table.name}`, error)
        return {
          name: table.name,
          label: table.label,
          description: table.description,
          exists: false,
          rowCount: null,
          lastUpdatedAt: null,
        }
      }
    })
  )

  return summaries
}

async function listRecentSyncRuns(): Promise<AdminSyncRunSummary[]> {
  if (!isDatabaseConfigured()) {
    return []
  }

  const db = getDb()
  try {
    const existsResult = await db.query<{ regclass: string | null }>(
      "select to_regclass($1) as regclass",
      ["sync_runs"]
    )
    if (!existsResult.rows[0]?.regclass) {
      return []
    }

    const result = await db.query<{
      id: number
      source: string
      mode: string
      status: string
      started_at: Date | string
      completed_at: Date | string | null
      details: unknown
    }>(
      `
      select id, source, mode, status, started_at, completed_at, details
      from sync_runs
      order by started_at desc
      limit 10
      `
    )

    return result.rows.map((row) => ({
      id: Number(row.id),
      source: row.source,
      mode: row.mode,
      status: row.status,
      startedAt: new Date(row.started_at).toISOString(),
      completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
      ...(row.details !== null && row.details !== undefined ? { details: row.details } : {}),
    }))
  } catch (error) {
    recordDbError("admin_sync_runs", error)
    return []
  }
}

async function readCopilotTraceTail(limit = 30): Promise<AdminTraceEntry[]> {
  try {
    const raw = await readFile(COPILOT_TRACE_FILE, "utf8")
    const chunk = raw.length > 500_000 ? raw.slice(-500_000) : raw
    return chunk
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line) as AdminTraceEntry)
      .reverse()
  } catch {
    return []
  }
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const [featuredOverride, copilotReviews, copilotTraceTail, tables, recentSyncRuns, artifacts, healthChecks, opsEventTail] =
    await Promise.all([
      getFeaturedOverride(),
      isDatabaseConfigured() ? listCopilotPromptReviews({ limit: 12 }) : Promise.resolve([]),
      readCopilotTraceTail(24),
      listTableSummaries(),
      listRecentSyncRuns(),
      listArtifacts(),
      getAdminHealthChecks(),
      readOpsEventTail(40),
    ])

  const envValidation = getEnvValidation()
  const playbooks = getIncidentPlaybooks()
  const opsMetrics = getOpsMetricSnapshots()
  const opsAlerts = getAlertSnapshots()
  const rateLimits = getRateLimitSnapshots()

  return {
    generatedAt: new Date().toISOString(),
    auth: {
      configured: isAdminConfigured(),
      usernameHint: getAdminUsernameHint(),
      protectedPrefixes: ["/admin", "/api/admin"],
    },
    database: {
      configured: isDatabaseConfigured(),
      tables,
      recentSyncRuns,
    },
    env: buildEnvEntries(),
    endpoints: ADMIN_ROUTE_CATALOG,
    plannedEndpoints: ADMIN_PLANNED_ENDPOINTS,
    artifacts,
    featuredOverride,
    copilotReviews,
    copilotTraceTail,
    healthChecks,
    opsMetrics,
    opsAlerts,
    rateLimits,
    opsEventTail,
    envValidation,
    playbooks,
  }
}
