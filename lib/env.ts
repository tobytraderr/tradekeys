function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name]
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const value = readOptionalEnv(name)
  if (!value) return fallback

  const normalized = value.toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) return true
  if (["0", "false", "no", "off"].includes(normalized)) return false
  return fallback
}

function readIntegerEnv(name: string, fallback: number): number {
  const value = readOptionalEnv(name)
  if (!value) return fallback

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function getFeaturedTwinId(): string | undefined {
  return readOptionalEnv("FEATURED_TWIN_ID")
}

export function getSubgraphUrl(): string | undefined {
  return readOptionalEnv("SUBGRAPH_URL")
}

export function getDatabaseUrl(): string | undefined {
  return readOptionalEnv("DATABASE_URL")
}

export function getTwinFunIndexerUrl(): string {
  return readOptionalEnv("TWINFUN_INDEXER_URL") ?? "https://twinindexer.memchat.io/subgraphs/name/digital"
}

export function getBscRpcUrl(): string | undefined {
  return readOptionalEnv("BSC_RPC_URL")
}

export function getImageProxyAllowedHosts(): string[] {
  const value = readOptionalEnv("IMAGE_PROXY_ALLOWED_HOSTS")
  if (!value) {
    return ["aggregator.suicore.com"]
  }
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

export function getSiteUrl(): string | undefined {
  return (
    readOptionalEnv("SITE_URL") ??
    readOptionalEnv("NEXT_PUBLIC_SITE_URL") ??
    readOptionalEnv("VERCEL_PROJECT_PRODUCTION_URL") ??
    readOptionalEnv("VERCEL_URL")
  )
}

export function getMetadataFetchAllowedHosts(): string[] {
  const value = readOptionalEnv("METADATA_FETCH_ALLOWED_HOSTS")
  if (!value) {
    return []
  }
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

export function getOpenGradientEndpoint(): string | undefined {
  return readOptionalEnv("OPENGRADIENT_API_URL")
}

export function getOpenGradientApiKey(): string | undefined {
  return readOptionalEnv("OPENGRADIENT_API_KEY")
}

export function getOpenGradientPrivateKey(): string | undefined {
  return readOptionalEnv("OPENGRADIENT_PRIVATE_KEY")
}

export function getOpenGradientModel(): string {
  return readOptionalEnv("OPENGRADIENT_MODEL") ?? "GPT_5_2"
}

export function getPythonBin(): string {
  return readOptionalEnv("PYTHON_BIN") ?? "python"
}

export function getAdminUsername(): string | undefined {
  return readOptionalEnv("ADMIN_USERNAME")
}

export function getAdminPassword(): string | undefined {
  return readOptionalEnv("ADMIN_PASSWORD")
}

export function getAdminAccessToken(): string | undefined {
  return readOptionalEnv("ADMIN_ACCESS_TOKEN")
}

export function getAdminAllowedIps(): string[] {
  const value = readOptionalEnv("ADMIN_ALLOWED_IPS")
  if (!value) {
    return []
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export type MarketDataRuntimeSource = "legacy" | "ingestion"

export function getMarketDataRuntimeSource(): MarketDataRuntimeSource {
  const value = readOptionalEnv("MARKET_DATA_RUNTIME_SOURCE")
  return value === "ingestion" ? "ingestion" : "legacy"
}

export function isLegacyMarketDataFallbackEnabled(): boolean {
  return readBooleanEnv("MARKET_DATA_LEGACY_FALLBACK_ENABLED", true)
}

export function getOpsAlertWindowMs(): number {
  return readIntegerEnv("OPS_ALERT_WINDOW_MS", 10 * 60_000)
}

export function getOpsRateLimitThreshold(): number {
  return readIntegerEnv("OPS_RATE_LIMIT_THRESHOLD", 3)
}

export function getOpsCacheRefreshFailureThreshold(): number {
  return readIntegerEnv("OPS_CACHE_REFRESH_FAILURE_THRESHOLD", 3)
}

export function getOpsDbErrorThreshold(): number {
  return readIntegerEnv("OPS_DB_ERROR_THRESHOLD", 2)
}

export function getOpsQuoteFailureThreshold(): number {
  return readIntegerEnv("OPS_QUOTE_FAILURE_THRESHOLD", 3)
}

export function getPublicApiRateLimitWindowMs(): number {
  return readIntegerEnv("PUBLIC_API_RATE_LIMIT_WINDOW_MS", 60_000)
}

export function getPublicApiMarketReadLimit(): number {
  return readIntegerEnv("PUBLIC_API_MARKET_READ_LIMIT", 120)
}

export function getPublicApiSearchLimit(): number {
  return readIntegerEnv("PUBLIC_API_SEARCH_LIMIT", 60)
}

export function getPublicApiQuoteLimit(): number {
  return readIntegerEnv("PUBLIC_API_QUOTE_LIMIT", 90)
}

export function getPublicApiImageLimit(): number {
  return readIntegerEnv("PUBLIC_API_IMAGE_LIMIT", 45)
}

export function isCopilotDailyPromptLimitEnabled(): boolean {
  return readBooleanEnv("COPILOT_DAILY_PROMPT_LIMIT_ENABLED", false)
}

export function getCopilotDailyPromptLimit(): number {
  return readIntegerEnv("COPILOT_DAILY_PROMPT_LIMIT", 3)
}

export function getPublicApiCopilotLimit(): number {
  return readIntegerEnv("PUBLIC_API_COPILOT_LIMIT", 20)
}

export function getMaxMetadataFetchBytes(): number {
  return readIntegerEnv("MAX_METADATA_FETCH_BYTES", 512_000)
}

export function getMaxImageProxyBytes(): number {
  return readIntegerEnv("MAX_IMAGE_PROXY_BYTES", 5 * 1024 * 1024)
}
