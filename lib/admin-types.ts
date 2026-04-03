import type { CopilotPromptReview, FeaturedOverride } from "@/lib/types"

export type AdminRouteField = {
  name: string
  required: boolean
  description: string
}

export type AdminRouteExample = {
  description: string
  example: unknown
}

export type AdminRouteDoc = {
  path: string
  methods: string[]
  audience: "public" | "wallet" | "admin"
  summary: string
  query?: AdminRouteField[]
  requestBody?: AdminRouteExample
  response: AdminRouteExample
  dataSources: string[]
  uiCapabilities: string[]
}

export type AdminPlannedEndpoint = {
  path: string
  methods: string[]
  summary: string
  purpose: string
  requestExample?: unknown
  responseExample?: unknown
}

export type AdminEnvEntry = {
  name: string
  category: "auth" | "database" | "market-data" | "ai" | "runtime"
  configured: boolean
  source: "env" | "default" | "missing"
  description: string
  safeValue?: string
}

export type AdminArtifactSummary = {
  label: string
  path: string
  description: string
  exists: boolean
  sizeBytes: number | null
  modifiedAt: string | null
  preview?: unknown
}

export type AdminTableSummary = {
  name: string
  label: string
  description: string
  exists: boolean
  rowCount: number | null
  lastUpdatedAt: string | null
}

export type AdminSyncRunSummary = {
  id: number
  source: string
  mode: string
  status: string
  startedAt: string
  completedAt: string | null
  details?: unknown
}

export type AdminTraceEntry = {
  timestamp: string
  traceId: string
  stage: string
  payload?: unknown
}

export type AdminHealthCheck = {
  target: "database" | "subgraph" | "bsc-rpc" | "ai-provider"
  status: "ok" | "degraded" | "down"
  latencyMs: number | null
  checkedAt: string
  detail: string
}

export type AdminOpsMetric = {
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

export type AdminOpsAlert = {
  id: "sustained_429s" | "cache_refresh_failures" | "db_errors" | "quote_path_failures"
  severity: "warning" | "critical"
  active: boolean
  count: number
  threshold: number
  windowMinutes: number
  message: string
}

export type AdminRateLimitSnapshot = {
  dependency: string
  count: number
  lastAt: string | null
}

export type AdminOpsEvent = {
  timestamp: string
  level: "info" | "warn" | "error"
  category: "upstream" | "cache" | "quote" | "transaction" | "api" | "health" | "trace" | "env" | "client"
  name: string
  message: string
  dependency?: string
  durationMs?: number
  statusCode?: number
  data?: Record<string, unknown>
}

export type AdminEnvValidation = {
  environment: string
  healthy: boolean
  missingCritical: string[]
  warnings: string[]
  defaultsInUse: string[]
}

export type AdminPlaybook = {
  id: "subgraph_outage" | "rpc_outage" | "db_outage" | "wallet_provider_breakage"
  title: string
  summary: string
  steps: string[]
}

export type AdminOverview = {
  generatedAt: string
  auth: {
    configured: boolean
    usernameHint: string | null
    protectedPrefixes: string[]
  }
  database: {
    configured: boolean
    tables: AdminTableSummary[]
    recentSyncRuns: AdminSyncRunSummary[]
  }
  env: AdminEnvEntry[]
  endpoints: AdminRouteDoc[]
  plannedEndpoints: AdminPlannedEndpoint[]
  artifacts: AdminArtifactSummary[]
  featuredOverride: FeaturedOverride | null
  copilotReviews: CopilotPromptReview[]
  copilotTraceTail: AdminTraceEntry[]
  healthChecks: AdminHealthCheck[]
  opsMetrics: AdminOpsMetric[]
  opsAlerts: AdminOpsAlert[]
  rateLimits: AdminRateLimitSnapshot[]
  opsEventTail: AdminOpsEvent[]
  envValidation: AdminEnvValidation
  playbooks: AdminPlaybook[]
}
