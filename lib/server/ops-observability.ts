import "server-only"

import { appendFile, mkdir, readFile } from "node:fs/promises"
import path from "node:path"
import {
  getOpsAlertWindowMs,
  getOpsCacheRefreshFailureThreshold,
  getOpsDbErrorThreshold,
  getOpsQuoteFailureThreshold,
  getOpsRateLimitThreshold,
} from "@/lib/env"

export type OpsEventLevel = "info" | "warn" | "error"
export type OpsEventCategory =
  | "upstream"
  | "cache"
  | "quote"
  | "transaction"
  | "api"
  | "health"
  | "trace"
  | "env"
  | "client"

export type OpsDependency =
  | "subgraph"
  | "rpc"
  | "database"
  | "ai"
  | "coingecko"
  | "wallet"
  | "app"

export type OpsEvent = {
  timestamp: string
  level: OpsEventLevel
  category: OpsEventCategory
  name: string
  message: string
  dependency?: OpsDependency | string
  traceId?: string
  durationMs?: number
  statusCode?: number
  data?: Record<string, unknown>
}

type MetricState = {
  key: string
  name: string
  labels: Record<string, string>
  count: number
  successCount: number
  failureCount: number
  totalDurationMs: number
  lastDurationMs: number | null
  lastAt: string | null
}

export type OpsMetricSnapshot = {
  key: string
  name: string
  labels: Record<string, string>
  count: number
  successCount: number
  failureCount: number
  successRatePct: number | null
  avgDurationMs: number | null
  lastDurationMs: number | null
  lastAt: string | null
}

export type OpsAlertSnapshot = {
  id: "sustained_429s" | "cache_refresh_failures" | "db_errors" | "quote_path_failures"
  severity: "warning" | "critical"
  active: boolean
  count: number
  threshold: number
  windowMinutes: number
  message: string
}

export type OpsRateLimitSnapshot = {
  dependency: string
  count: number
  lastAt: string | null
}

const OPS_DIR = path.join(process.cwd(), "data", "ops")
export const OPS_EVENT_LOG_FILE = path.join(OPS_DIR, "ops-events.ndjson")

const MAX_IN_MEMORY_EVENTS = 300
const metricState = new Map<string, MetricState>()
const eventBuffer: OpsEvent[] = []

function metricKey(name: string, labels: Record<string, string>) {
  const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right))
  return `${name}:${JSON.stringify(entries)}`
}

async function persistEvent(event: OpsEvent) {
  try {
    await mkdir(OPS_DIR, { recursive: true })
    await appendFile(OPS_EVENT_LOG_FILE, `${JSON.stringify(event)}\n`, "utf8")
  } catch {
    // Avoid cascading observability failures back into request paths.
  }
}

export function recordOpsEvent(event: Omit<OpsEvent, "timestamp">) {
  const nextEvent: OpsEvent = {
    timestamp: new Date().toISOString(),
    ...event,
  }

  eventBuffer.push(nextEvent)
  if (eventBuffer.length > MAX_IN_MEMORY_EVENTS) {
    eventBuffer.splice(0, eventBuffer.length - MAX_IN_MEMORY_EVENTS)
  }

  void persistEvent(nextEvent)
  return nextEvent
}

export function recordMetric(input: {
  name: string
  labels?: Record<string, string>
  ok?: boolean
  durationMs?: number
}) {
  const labels = input.labels ?? {}
  const key = metricKey(input.name, labels)
  const state = metricState.get(key) ?? {
    key,
    name: input.name,
    labels,
    count: 0,
    successCount: 0,
    failureCount: 0,
    totalDurationMs: 0,
    lastDurationMs: null,
    lastAt: null,
  }

  state.count += 1
  if (input.ok === true) {
    state.successCount += 1
  } else if (input.ok === false) {
    state.failureCount += 1
  }
  if (typeof input.durationMs === "number" && Number.isFinite(input.durationMs)) {
    state.totalDurationMs += input.durationMs
    state.lastDurationMs = input.durationMs
  }
  state.lastAt = new Date().toISOString()

  metricState.set(key, state)
}

export async function withOpsTrace<T>(input: {
  name: string
  dependency?: OpsDependency | string
  data?: Record<string, unknown>
  task: () => Promise<T>
}): Promise<T> {
  const startedAt = Date.now()
  const traceId = `${input.name}-${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  recordOpsEvent({
    level: "info",
    category: "trace",
    name: `${input.name}.start`,
    message: `${input.name} started`,
    dependency: input.dependency,
    traceId,
    data: input.data,
  })

  try {
    const result = await input.task()
    const durationMs = Date.now() - startedAt
    recordMetric({
      name: input.name,
      labels: input.dependency ? { dependency: String(input.dependency) } : {},
      ok: true,
      durationMs,
    })
    recordOpsEvent({
      level: "info",
      category: "trace",
      name: `${input.name}.success`,
      message: `${input.name} completed`,
      dependency: input.dependency,
      traceId,
      durationMs,
      data: input.data,
    })
    return result
  } catch (error) {
    const durationMs = Date.now() - startedAt
    recordMetric({
      name: input.name,
      labels: input.dependency ? { dependency: String(input.dependency) } : {},
      ok: false,
      durationMs,
    })
    recordOpsEvent({
      level: "error",
      category: "trace",
      name: `${input.name}.failure`,
      message: error instanceof Error ? error.message : `${input.name} failed`,
      dependency: input.dependency,
      traceId,
      durationMs,
      data: input.data,
    })
    throw error
  }
}

export function recordCacheEvent(input: {
  cache: "homepage" | "twin-detail"
  outcome: "hit" | "miss" | "refresh_success" | "refresh_failure" | "stale_served"
  twinId?: string
  ageMs?: number
  error?: unknown
}) {
  const ok = input.outcome === "hit" || input.outcome === "refresh_success"
  recordMetric({
    name: "cache_access",
    labels: {
      cache: input.cache,
      outcome: input.outcome,
    },
    ok,
  })
  if (typeof input.ageMs === "number" && Number.isFinite(input.ageMs)) {
    recordMetric({
      name: "cache_age",
      labels: {
        cache: input.cache,
        outcome: input.outcome,
      },
      durationMs: input.ageMs,
    })
  }
  recordOpsEvent({
    level:
      input.outcome === "refresh_failure"
        ? "error"
        : input.outcome === "stale_served" || input.outcome === "miss"
          ? "warn"
          : "info",
    category: "cache",
    name: `${input.cache}.${input.outcome}`,
    message:
      input.error instanceof Error
        ? input.error.message
        : typeof input.error === "string"
          ? input.error
          : `${input.cache} cache ${input.outcome.replaceAll("_", " ")}`,
    dependency: "app",
    data: {
      ...(input.twinId ? { twinId: input.twinId } : {}),
      ...(typeof input.ageMs === "number" ? { ageMs: input.ageMs } : {}),
    },
  })
}

export function recordUpstreamFailure(input: {
  dependency: OpsDependency | string
  operation: string
  error?: unknown
  statusCode?: number
  durationMs?: number
  data?: Record<string, unknown>
}) {
  recordMetric({
    name: "upstream_request",
    labels: {
      dependency: String(input.dependency),
      operation: input.operation,
    },
    ok: false,
    durationMs: input.durationMs,
  })
  recordOpsEvent({
    level: input.statusCode === 429 ? "warn" : "error",
    category: "upstream",
    name: `${input.operation}.failure`,
    message:
      input.error instanceof Error
        ? input.error.message
        : `Upstream failure for ${input.operation}`,
    dependency: input.dependency,
    statusCode: input.statusCode,
    durationMs: input.durationMs,
    data: input.data,
  })
}

export function recordUpstreamSuccess(input: {
  dependency: OpsDependency | string
  operation: string
  statusCode?: number
  durationMs?: number
}) {
  recordMetric({
    name: "upstream_request",
    labels: {
      dependency: String(input.dependency),
      operation: input.operation,
    },
    ok: true,
    durationMs: input.durationMs,
  })
}

export function recordApiEvent(input: {
  route: string
  method: string
  statusCode: number
  durationMs?: number
}) {
  recordMetric({
    name: "api_request",
    labels: {
      route: input.route,
      method: input.method,
    },
    ok: input.statusCode < 400,
    durationMs: input.durationMs,
  })

  if (input.statusCode >= 400) {
    recordOpsEvent({
      level: input.statusCode >= 500 ? "error" : "warn",
      category: "api",
      name: `${input.route}.error`,
      message: `${input.method} ${input.route} returned ${input.statusCode}`,
      dependency: "app",
      statusCode: input.statusCode,
      durationMs: input.durationMs,
    })
  }
}

export function recordQuoteFailure(input: {
  path: string
  twinId?: string
  error?: unknown
  durationMs?: number
}) {
  recordMetric({
    name: "quote_path",
    labels: { path: input.path },
    ok: false,
    durationMs: input.durationMs,
  })
  recordOpsEvent({
    level: "error",
    category: "quote",
    name: `${input.path}.failure`,
    message:
      input.error instanceof Error ? input.error.message : "Quote path failed",
    dependency: "rpc",
    durationMs: input.durationMs,
    data: input.twinId ? { twinId: input.twinId } : undefined,
  })
}

export function recordQuoteSuccess(input: {
  path: string
  twinId?: string
  durationMs?: number
}) {
  recordMetric({
    name: "quote_path",
    labels: { path: input.path },
    ok: true,
    durationMs: input.durationMs,
  })
}

export function recordDbError(operation: string, error: unknown) {
  recordMetric({
    name: "database_operation",
    labels: { operation },
    ok: false,
  })
  recordOpsEvent({
    level: "error",
    category: "api",
    name: `db.${operation}.failure`,
    message: error instanceof Error ? error.message : `Database operation ${operation} failed`,
    dependency: "database",
  })
}

export function recordClientFailure(input: {
  name: "wallet_connect_failure" | "transaction_submission_failure"
  message: string
  data?: Record<string, unknown>
}) {
  recordMetric({
    name: input.name,
    labels: {},
    ok: false,
  })
  recordOpsEvent({
    level: "warn",
    category: "client",
    name: input.name,
    message: input.message,
    dependency: input.name === "wallet_connect_failure" ? "wallet" : "app",
    data: input.data,
  })
}

export function getOpsMetricSnapshots(): OpsMetricSnapshot[] {
  return [...metricState.values()]
    .map((item) => ({
      key: item.key,
      name: item.name,
      labels: item.labels,
      count: item.count,
      successCount: item.successCount,
      failureCount: item.failureCount,
      successRatePct:
        item.successCount + item.failureCount > 0
          ? Number(((item.successCount / (item.successCount + item.failureCount)) * 100).toFixed(1))
          : null,
      avgDurationMs:
        item.count > 0 && item.totalDurationMs > 0
          ? Number((item.totalDurationMs / item.count).toFixed(1))
          : null,
      lastDurationMs: item.lastDurationMs,
      lastAt: item.lastAt,
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function getRecentOpsEvents(limit = 80): OpsEvent[] {
  return eventBuffer.slice(-limit).reverse()
}

export async function readOpsEventTail(limit = 80): Promise<OpsEvent[]> {
  try {
    const raw = await readFile(OPS_EVENT_LOG_FILE, "utf8")
    const chunk = raw.length > 750_000 ? raw.slice(-750_000) : raw
    return chunk
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line) as OpsEvent)
      .reverse()
  } catch {
    return getRecentOpsEvents(limit)
  }
}

function countEventsWithinWindow(predicate: (event: OpsEvent) => boolean, windowMs: number) {
  const threshold = Date.now() - windowMs
  return eventBuffer.filter((event) => Date.parse(event.timestamp) >= threshold).filter(predicate)
}

export function getRateLimitSnapshots(): OpsRateLimitSnapshot[] {
  const windowMs = getOpsAlertWindowMs()
  const relevant = countEventsWithinWindow(
    (event) => event.statusCode === 429 && event.category === "upstream",
    windowMs
  )

  const aggregate = new Map<string, OpsRateLimitSnapshot>()
  for (const event of relevant) {
    const key = event.dependency ?? "unknown"
    const current = aggregate.get(key) ?? {
      dependency: key,
      count: 0,
      lastAt: null,
    }
    current.count += 1
    current.lastAt = event.timestamp
    aggregate.set(key, current)
  }

  return [...aggregate.values()].sort((left, right) => right.count - left.count)
}

export function getAlertSnapshots(): OpsAlertSnapshot[] {
  const windowMs = getOpsAlertWindowMs()
  const windowMinutes = Math.round(windowMs / 60_000)
  const rateLimitCount = countEventsWithinWindow(
    (event) => event.statusCode === 429 && event.category === "upstream",
    windowMs
  ).length
  const cacheFailureCount = countEventsWithinWindow(
    (event) => event.category === "cache" && event.name.endsWith("refresh_failure"),
    windowMs
  ).length
  const dbErrorCount = countEventsWithinWindow(
    (event) => event.dependency === "database" && event.level === "error",
    windowMs
  ).length
  const quoteFailureCount = countEventsWithinWindow(
    (event) => event.category === "quote",
    windowMs
  ).length

  return [
    {
      id: "sustained_429s",
      severity: "warning",
      active: rateLimitCount >= getOpsRateLimitThreshold(),
      count: rateLimitCount,
      threshold: getOpsRateLimitThreshold(),
      windowMinutes,
      message: "Sustained upstream rate limiting detected.",
    },
    {
      id: "cache_refresh_failures",
      severity: "warning",
      active: cacheFailureCount >= getOpsCacheRefreshFailureThreshold(),
      count: cacheFailureCount,
      threshold: getOpsCacheRefreshFailureThreshold(),
      windowMinutes,
      message: "Homepage or twin-detail cache refresh is failing repeatedly.",
    },
    {
      id: "db_errors",
      severity: "critical",
      active: dbErrorCount >= getOpsDbErrorThreshold(),
      count: dbErrorCount,
      threshold: getOpsDbErrorThreshold(),
      windowMinutes,
      message: "Database errors crossed the critical threshold.",
    },
    {
      id: "quote_path_failures",
      severity: "critical",
      active: quoteFailureCount >= getOpsQuoteFailureThreshold(),
      count: quoteFailureCount,
      threshold: getOpsQuoteFailureThreshold(),
      windowMinutes,
      message: "Live quote generation is failing repeatedly.",
    },
  ]
}
