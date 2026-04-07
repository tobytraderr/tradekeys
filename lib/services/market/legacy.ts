import "server-only"

import { formatEther } from "viem"
import { convertBnbToUsd, formatCompactUsd } from "@/lib/currency"
import {
  getBscRpcUrl,
  getFeaturedTwinId,
  getOpenGradientPrivateKey,
  getSubgraphUrl,
} from "@/lib/env"
import {
  getCatalogMetadata,
  getCatalogMetadataMap,
  searchCatalogTwins,
} from "@/lib/server/catalog-store"
import { isDatabaseConfigured } from "@/lib/server/db"
import { getFeaturedOverride } from "@/lib/server/featured-store"
import {
  getHomepageCacheEntry,
  setHomepageCacheFailure,
  setHomepageCacheSnapshot,
  type HomepageCacheEntry,
} from "@/lib/server/homepage-cache-store"
import {
  getTwinDetailCacheEntry,
  setTwinDetailCacheFailure,
  setTwinDetailCachePayload,
  type TwinDetailCacheEntry,
} from "@/lib/server/twin-detail-cache-store"
import {
  getTwinMetadata,
  getTwinMetadataBatch,
} from "@/lib/server/twin-metadata-store"
import {
  fetchAddressNativeBalance,
  fetchBnbUsdPrice,
  fetchLiveTwinOwnerAndUrl,
  fetchLiveTwinQuote,
} from "@/lib/server/rpc"
import { listWatchlistTwinIds } from "@/lib/server/watchlist-store"
import {
  fetchMomentumSnapshots,
  fetchHomepageSubgraphData,
  fetchTwinDetailSubgraphData,
} from "@/lib/server/subgraph"
import {
  recordCacheEvent,
  recordDbError,
  withOpsTrace,
} from "@/lib/server/ops-observability"
import { summarizeWithOpenGradient } from "@/lib/services/copilot"
import type {
  ActivityItem,
  AiCopilotMode,
  AiCopilotSnapshot,
  AiCopilotTwinCard,
  AiHealthSnapshot,
  AppMeta,
  CopilotInsight,
  FeaturedTwin,
  HomepageSnapshot,
  TwinChartPoint,
  TwinDetailHolder,
  TwinDetailInsight,
  TwinDetailInsightStat,
  TwinDetailSnapshot,
  TwinDetailTrade,
  TwinQuote,
  TwinSummary,
  WatchlistDashboardItem,
  WatchlistDashboardSnapshot,
  WalletActivityTier,
} from "@/lib/types"

type RawTwin = {
  id: string
  url?: string | null
  owner?: string | null
  supply: string
  createdAt: string
  totalTrades: string
  totalVolumeEth: string
  uniqueHolders: string
  activeHolders: string
  lastTradeAt?: string | null
  lastTrader?: string | null
  lastTradeIsBuy?: boolean | null
  lastTradeEthAmount?: string | null
  lastTradeShareAmount?: string | null
}

type RawHourlySnapshot = {
  id: string
  bucketStart: string
  volumeEth: string
  openPriceEth: string
  highPriceEth?: string
  lowPriceEth?: string
  closePriceEth: string
  trades?: string
  activeHolders?: string
  digitalTwin: {
    id: string
  }
}

type RawTwinHolder = {
  id: string
  holder: string
  balance: string
  firstSeenAt?: string | null
  lastTradeAt?: string | null
  tradeCount: string
  isActive: boolean
}

type RawTwinTrade = {
  id: string
  txHash: string
  trader: string
  isBuy: boolean
  shareAmount: string
  ethAmount: string
  pricePerShareEth?: string | null
  blockNumber: string
  blockTimestamp: string
}

type RawTwinDetail = RawTwin & {
  updatedAt?: string
  buyTrades?: string
  sellTrades?: string
  trades?: RawTwinTrade[]
  holders?: RawTwinHolder[]
}

type RawTrade = {
  id: string
  trader: string
  isBuy: boolean
  shareAmount: string
  ethAmount: string
  blockTimestamp: string
  digitalTwin: {
    id: string
    url?: string | null
  }
}

type TwinDetailSubgraphPayload = Awaited<ReturnType<typeof fetchTwinDetailSubgraphData>>

type HomepageBaseData = {
  totalTwins: number
  trendingTwins: TwinSummary[]
  latestTwins: TwinSummary[]
  newTwins: TwinSummary[]
  watchlist: TwinSummary[]
  activity: ActivityItem[]
  error?: string
}

const HOMEPAGE_CACHE_TTL_MS = 60_000
const HOMEPAGE_STALE_SERVE_TTL_MS = 10 * 60_000
const HOMEPAGE_RETRY_BASE_MS = 60_000
const HOMEPAGE_RETRY_MAX_MS = 10 * 60_000
const HOMEPAGE_GENERAL_RETRY_MS = 30_000
const TWIN_DETAIL_CACHE_TTL_MS = 60_000

type HomepageBaseCacheState = HomepageCacheEntry<HomepageBaseData>
type TwinDetailCacheState = TwinDetailCacheEntry<TwinDetailSubgraphPayload>

let homepageBaseMemoryCache: HomepageBaseCacheState | null = null
let homepageBaseRefreshPromise: Promise<HomepageBaseData> | null = null
const twinDetailMemoryCache = new Map<string, TwinDetailCacheState>()
const twinDetailRefreshPromises = new Map<string, Promise<TwinDetailSubgraphPayload | null>>()

function emptyHomepageBaseData(error?: string): HomepageBaseData {
  return {
    totalTwins: 0,
    trendingTwins: [],
    latestTwins: [],
    newTwins: [],
    watchlist: [],
    activity: [],
    ...(error ? { error } : {}),
  }
}

function isRateLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "")
  return /\b429\b/.test(message)
}

function computeHomepageRetryDelayMs(error: unknown, failureCount: number) {
  if (isRateLimitError(error)) {
    const multiplier = Math.max(0, failureCount - 1)
    return Math.min(HOMEPAGE_RETRY_BASE_MS * 2 ** multiplier, HOMEPAGE_RETRY_MAX_MS)
  }

  return HOMEPAGE_GENERAL_RETRY_MS
}

function hasActiveRetryWindow(retryAfter: string | null | undefined) {
  return Boolean(retryAfter && Date.parse(retryAfter) > Date.now())
}

function isHomepageCacheFresh(lastSuccessAt: string | null | undefined) {
  return Boolean(lastSuccessAt && Date.now() - Date.parse(lastSuccessAt) < HOMEPAGE_CACHE_TTL_MS)
}

function canServeHomepageStale(lastSuccessAt: string | null | undefined) {
  return Boolean(lastSuccessAt && Date.now() - Date.parse(lastSuccessAt) < HOMEPAGE_STALE_SERVE_TTL_MS)
}

function getCachedHomepageMessage(error: unknown) {
  if (isRateLimitError(error)) {
    return "Live market data is temporarily rate-limited. Showing the most recent cached snapshot."
  }

  return "Live market data refresh failed. Showing the most recent cached snapshot."
}

function getRefreshingHomepageMessage() {
  return "Showing the most recent cached market snapshot while TradeKeys refreshes live data in the background."
}

function getHomepageFailureMessage(error: unknown) {
  if (!getSubgraphUrl()) {
    return "Market data source is not configured. Set SUBGRAPH_URL and restart the server."
  }

  if (isRateLimitError(error)) {
    return "Live market data is temporarily rate-limited. Refresh will resume automatically."
  }

  return error instanceof Error ? error.message : "Failed to load homepage market data."
}

function withHomepageStatus(base: HomepageBaseData, error?: string): HomepageBaseData {
  return error ? { ...base, error } : { ...base, error: undefined }
}

async function readHomepageBaseCache(): Promise<HomepageBaseCacheState | null> {
  if (isDatabaseConfigured()) {
    try {
      const cached = await getHomepageCacheEntry<HomepageBaseData>()
      if (cached) {
        homepageBaseMemoryCache = cached
      }
      return cached ?? homepageBaseMemoryCache
    } catch (error) {
      console.error("[homepage] cache read failed:", error)
      recordDbError("homepage_cache_read", error)
      return homepageBaseMemoryCache
    }
  }

  return homepageBaseMemoryCache
}

async function writeHomepageBaseCache(base: HomepageBaseData) {
  const nextState: HomepageBaseCacheState = {
    snapshot: { ...base, error: undefined },
    lastSuccessAt: new Date().toISOString(),
    lastAttemptAt: new Date().toISOString(),
    retryAfter: null,
    failureCount: 0,
    lastError: null,
  }

  if (isDatabaseConfigured()) {
    try {
      await setHomepageCacheSnapshot(nextState.snapshot)
    } catch (error) {
      console.error("[homepage] cache write failed:", error)
      recordDbError("homepage_cache_write", error)
    }
  }

  homepageBaseMemoryCache = nextState
}

async function writeHomepageBaseFailure(error: unknown, failureCount: number) {
  const retryAfter = new Date(Date.now() + computeHomepageRetryDelayMs(error, failureCount))
  const lastError = error instanceof Error ? error.message : String(error ?? "Unknown error")

  if (isDatabaseConfigured()) {
    try {
      await setHomepageCacheFailure({ error: lastError, retryAfter })
    } catch (dbError) {
      console.error("[homepage] cache failure write failed:", dbError)
      recordDbError("homepage_cache_failure_write", dbError)
    }
  }

  homepageBaseMemoryCache = {
    ...(homepageBaseMemoryCache ?? {
      snapshot: null,
      lastSuccessAt: null,
    }),
    lastAttemptAt: new Date().toISOString(),
    retryAfter: retryAfter.toISOString(),
    failureCount,
    lastError,
  }
}

async function readTwinDetailCache(id: string): Promise<TwinDetailCacheState | null> {
  if (isDatabaseConfigured()) {
    try {
      const cached = await getTwinDetailCacheEntry<TwinDetailSubgraphPayload>(id)
      if (cached) {
        twinDetailMemoryCache.set(id, cached)
      }
      return cached ?? twinDetailMemoryCache.get(id) ?? null
    } catch (error) {
      console.error("[twin-detail] cache read failed:", error)
      recordDbError("twin_detail_cache_read", error)
      return twinDetailMemoryCache.get(id) ?? null
    }
  }

  return twinDetailMemoryCache.get(id) ?? null
}

async function writeTwinDetailCache(id: string, payload: TwinDetailSubgraphPayload) {
  const nextState: TwinDetailCacheState = {
    payload,
    lastSuccessAt: new Date().toISOString(),
    lastAttemptAt: new Date().toISOString(),
    retryAfter: null,
    failureCount: 0,
    lastError: null,
  }

  if (isDatabaseConfigured()) {
    try {
      await setTwinDetailCachePayload(id, payload)
    } catch (error) {
      console.error("[twin-detail] cache write failed:", error)
      recordDbError("twin_detail_cache_write", error)
    }
  }

  twinDetailMemoryCache.set(id, nextState)
}

async function writeTwinDetailCacheFailure(id: string, error: unknown, failureCount: number) {
  const retryAfter = new Date(Date.now() + computeHomepageRetryDelayMs(error, failureCount))
  const lastError = error instanceof Error ? error.message : String(error ?? "Unknown error")

  if (isDatabaseConfigured()) {
    try {
      await setTwinDetailCacheFailure({ twinId: id, error: lastError, retryAfter })
    } catch (dbError) {
      console.error("[twin-detail] cache failure write failed:", dbError)
      recordDbError("twin_detail_cache_failure_write", dbError)
    }
  }

  const existing = twinDetailMemoryCache.get(id)
  twinDetailMemoryCache.set(id, {
    payload: existing?.payload ?? null,
    lastSuccessAt: existing?.lastSuccessAt ?? null,
    lastAttemptAt: new Date().toISOString(),
    retryAfter: retryAfter.toISOString(),
    failureCount,
    lastError,
  })
}

function getTwinDetailCachedMessage(error: unknown) {
  if (isRateLimitError(error)) {
    return "Live twin market data is temporarily rate-limited. Showing the most recent cached snapshot."
  }

  return "Live twin market data refresh failed. Showing the most recent cached snapshot."
}

function getTwinDetailFailureMessage(error: unknown) {
  if (!getSubgraphUrl()) {
    return "Twin market data source is not configured. Set SUBGRAPH_URL and restart the server."
  }

  if (isRateLimitError(error)) {
    return "Live twin market data is temporarily rate-limited. Refresh will resume automatically."
  }

  return error instanceof Error ? error.message : "Failed to load twin market data."
}

async function fetchCachedTwinDetailPayload(id: string): Promise<{
  payload: TwinDetailSubgraphPayload | null
  error?: string
  unavailable?: boolean
}> {
  const cached = await readTwinDetailCache(id)

  if (cached?.payload && isHomepageCacheFresh(cached.lastSuccessAt)) {
    recordCacheEvent({
      cache: "twin-detail",
      twinId: id,
      outcome: "hit",
      ageMs: cached.lastSuccessAt ? Date.now() - Date.parse(cached.lastSuccessAt) : undefined,
    })
    return { payload: cached.payload }
  }

  if (cached?.payload && hasActiveRetryWindow(cached.retryAfter)) {
    recordCacheEvent({
      cache: "twin-detail",
      twinId: id,
      outcome: "stale_served",
      ageMs: cached.lastSuccessAt ? Date.now() - Date.parse(cached.lastSuccessAt) : undefined,
      error: cached.lastError ?? undefined,
    })
    return {
      payload: cached.payload,
      error: getTwinDetailCachedMessage(cached.lastError),
    }
  }

  const inflight = twinDetailRefreshPromises.get(id)
  if (inflight) {
    if (cached?.payload) {
      recordCacheEvent({
        cache: "twin-detail",
        twinId: id,
        outcome: "stale_served",
        ageMs: cached.lastSuccessAt ? Date.now() - Date.parse(cached.lastSuccessAt) : undefined,
        error: cached.lastError ?? undefined,
      })
      return {
        payload: cached.payload,
        error: getTwinDetailCachedMessage(cached.lastError),
      }
    }

    const payload = await inflight
    return { payload }
  }

  recordCacheEvent({
    cache: "twin-detail",
    twinId: id,
    outcome: "miss",
    ageMs: cached?.lastSuccessAt ? Date.now() - Date.parse(cached.lastSuccessAt) : undefined,
  })

  const refreshPromise = (async () => {
    try {
      const fresh = await fetchTwinDetailSubgraphData(id)
      if (fresh?.digitalTwin) {
        await writeTwinDetailCache(id, fresh)
      }
      recordCacheEvent({
        cache: "twin-detail",
        twinId: id,
        outcome: "refresh_success",
      })
      return fresh
    } catch (error) {
      console.error(`[twin-detail] subgraph fetch failed for ${id}:`, error)
      recordCacheEvent({
        cache: "twin-detail",
        twinId: id,
        outcome: "refresh_failure",
        error,
      })
      const failureCount = Math.max(1, (cached?.failureCount ?? 0) + 1)
      await writeTwinDetailCacheFailure(id, error, failureCount)

      if (cached?.payload) {
        recordCacheEvent({
          cache: "twin-detail",
          twinId: id,
          outcome: "stale_served",
          ageMs: cached.lastSuccessAt ? Date.now() - Date.parse(cached.lastSuccessAt) : undefined,
          error,
        })
        return cached.payload
      }

      throw error
    } finally {
      twinDetailRefreshPromises.delete(id)
    }
  })()

  twinDetailRefreshPromises.set(id, refreshPromise)

  try {
    const payload = await refreshPromise
    return { payload }
  } catch (error) {
    return {
      payload: null,
      error: getTwinDetailFailureMessage(error),
      unavailable: true,
    }
  }
}

type TradeSignal = {
  isBuy: boolean
  timestamp: number
}

function parseNumber(value: string | null | undefined): number {
  if (!value) return 0
  try {
    return Number(BigInt(value))
  } catch {
    return 0
  }
}

function parseEth(value: string | null | undefined): number {
  if (!value) return 0
  try {
    return Number(formatEther(BigInt(value)))
  } catch {
    return 0
  }
}

function resolveHourlyChange(
  hourlySnapshots: Array<Pick<RawHourlySnapshot, "openPriceEth" | "closePriceEth">>
): number {
  const latest = hourlySnapshots[0]
  const previous = hourlySnapshots[1]
  const currentClose = latest ? parseEth(latest.closePriceEth) : 0
  const previousClose = previous
    ? parseEth(previous.closePriceEth)
    : latest
      ? parseEth(latest.openPriceEth)
      : 0

  return clampMetric(toPercentChange(currentClose, previousClose), -99.9, 999)
}

function resolveRolling24hVolumeEth(
  hourlySnapshots: Array<Pick<RawHourlySnapshot, "bucketStart" | "volumeEth">>
): number {
  return resolveHourlyVolumeMetrics(hourlySnapshots).rolling24hVolumeEth
}

function resolveHourlyVolumeMetrics(
  hourlySnapshots: Array<Pick<RawHourlySnapshot, "bucketStart" | "volumeEth">>
) {
  if (hourlySnapshots.length === 0) {
    return {
      latest1hVolumeEth: 0,
      previous1hVolumeEth: 0,
      rolling24hVolumeEth: 0,
      volumeChange1hPct: 0,
    }
  }

  const latest = hourlySnapshots[0]
  const previous = hourlySnapshots[1]
  const latest1hVolumeEth = latest ? parseEth(latest.volumeEth) : 0
  const previous1hVolumeEth = previous ? parseEth(previous.volumeEth) : 0
  const latestBucketStart = hourlySnapshots.reduce(
    (max, snapshot) => Math.max(max, Number(snapshot.bucketStart)),
    0
  )
  const cutoff = latestBucketStart - 24 * 60 * 60

  const rolling24hVolumeEth = hourlySnapshots.reduce((sum, snapshot) => {
    return Number(snapshot.bucketStart) > cutoff ? sum + parseEth(snapshot.volumeEth) : sum
  }, 0)

  const volumeChange1hPct =
    previous1hVolumeEth > 0
      ? clampMetric(((latest1hVolumeEth - previous1hVolumeEth) / previous1hVolumeEth) * 100, -99.9, 999)
      : latest1hVolumeEth > 0
        ? 100
        : 0

  return {
    latest1hVolumeEth,
    previous1hVolumeEth,
    rolling24hVolumeEth,
    volumeChange1hPct,
  }
}

function formatAgeLabel(createdAt: string): string {
  const created = Number(createdAt) * 1000
  const diffMs = Math.max(0, Date.now() - created)
  const diffMinutes = Math.floor(diffMs / 60000)
  if (diffMinutes < 60) return `${diffMinutes}m`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d`
}

function shortTwinLabel(id: string): string {
  return id.length > 12 ? `${id.slice(0, 10)}…` : id
}

function shortenAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address
}

function formatAddressLabel(address: string) {
  return shortenAddress(address)
}

function mapChartPoint(
  snapshot: RawHourlySnapshot,
  usdPerBnb: number | null
): TwinChartPoint {
  const openBnb = parseEth(snapshot.openPriceEth)
  const highBnb = parseEth(snapshot.highPriceEth ?? snapshot.closePriceEth)
  const lowBnb = parseEth(snapshot.lowPriceEth ?? snapshot.openPriceEth)
  const closeBnb = parseEth(snapshot.closePriceEth)
  const volumeBnb = parseEth(snapshot.volumeEth)

  return {
    time: Number(snapshot.bucketStart),
    openUsd: typeof usdPerBnb === "number" ? convertBnbToUsd(openBnb, usdPerBnb) : 0,
    highUsd: typeof usdPerBnb === "number" ? convertBnbToUsd(highBnb, usdPerBnb) : 0,
    lowUsd: typeof usdPerBnb === "number" ? convertBnbToUsd(lowBnb, usdPerBnb) : 0,
    closeUsd: typeof usdPerBnb === "number" ? convertBnbToUsd(closeBnb, usdPerBnb) : 0,
    volumeUsd: typeof usdPerBnb === "number" ? convertBnbToUsd(volumeBnb, usdPerBnb) : 0,
    volumeBnb,
    trades: parseNumber(snapshot.trades),
    activeHolders: parseNumber(snapshot.activeHolders),
  }
}

function mapDetailTrade(
  trade: RawTwinTrade,
  usdPerBnb: number | null
): TwinDetailTrade {
  const bnbAmount = parseEth(trade.ethAmount)
  const pricePerShareBnb = parseEth(trade.pricePerShareEth)

  return {
    id: trade.id,
    txHash: trade.txHash,
    trader: trade.trader,
    isBuy: trade.isBuy,
    shareAmount: parseNumber(trade.shareAmount),
    bnbAmount,
    usdAmount: typeof usdPerBnb === "number" ? convertBnbToUsd(bnbAmount, usdPerBnb) : 0,
    pricePerShareUsd:
      typeof usdPerBnb === "number" ? convertBnbToUsd(pricePerShareBnb, usdPerBnb) : 0,
    timestamp: Number(trade.blockTimestamp),
    blockNumber: parseNumber(trade.blockNumber),
  }
}

function mapDetailHolder(holder: RawTwinHolder, supply: number): TwinDetailHolder {
  const balance = parseNumber(holder.balance)
  return {
    id: holder.id,
    holder: holder.holder,
    balance,
    sharePct: supply > 0 ? (balance / supply) * 100 : 0,
    tradeCount: parseNumber(holder.tradeCount),
    isActive: Boolean(holder.isActive),
    firstSeenAt: holder.firstSeenAt ? Number(holder.firstSeenAt) : undefined,
    lastTradeAt: holder.lastTradeAt ? Number(holder.lastTradeAt) : undefined,
  }
}

function dedupeTwins(twins: TwinSummary[]): TwinSummary[] {
  const seen = new Set<string>()
  return twins.filter((twin) => {
    if (seen.has(twin.id)) return false
    seen.add(twin.id)
    return true
  })
}

function buildTradeSignalMap(trades: RawTrade[]): Map<string, TradeSignal> {
  const map = new Map<string, TradeSignal>()
  for (const trade of trades) {
    if (!map.has(trade.digitalTwin.id)) {
      map.set(trade.digitalTwin.id, {
        isBuy: trade.isBuy,
        timestamp: Number(trade.blockTimestamp),
      })
    }
  }
  return map
}

function mapTwin(raw: RawTwin, signals: Map<string, TradeSignal>): TwinSummary {
  const lastTradeEth = parseEth(raw.lastTradeEthAmount)
  const lastTradeShares = parseNumber(raw.lastTradeShareAmount)
  const lastPrice = lastTradeShares > 0 ? lastTradeEth / lastTradeShares : 0
  const totalVolumeEth = parseEth(raw.totalVolumeEth)
  const signal = signals.get(raw.id)
  const resolvedSignal =
    typeof raw.lastTradeIsBuy === "boolean"
      ? raw.lastTradeIsBuy
        ? "buy"
        : "sell"
      : signal
        ? signal.isBuy
          ? "buy"
          : "sell"
        : "watch"

  return {
    id: raw.id,
    displayName: shortTwinLabel(raw.id),
    owner: raw.owner || "Unclaimed",
    metadataUrl: raw.url || undefined,
    supply: parseNumber(raw.supply),
    holders: parseNumber(raw.activeHolders || raw.uniqueHolders),
    totalTrades: parseNumber(raw.totalTrades),
    totalVolumeEth,
    totalVolumeUsd: 0,
    volume24hEth: totalVolumeEth,
    volume24hUsd: 0,
    volume1hEth: 0,
    volume1hUsd: 0,
    lastPriceEth: lastPrice,
    lastPriceUsd: 0,
    change1hPct: 0,
    ageLabel: formatAgeLabel(raw.createdAt),
    lastTradeAt: raw.lastTradeAt ? Number(raw.lastTradeAt) : signal?.timestamp,
    lastTrader: raw.lastTrader || undefined,
    signal: resolvedSignal,
  }
}

function applyUsdToTwin(twin: TwinSummary, usdPerBnb: number | null): TwinSummary {
  if (typeof usdPerBnb !== "number") {
    return twin
  }

  return {
    ...twin,
    totalVolumeUsd: convertBnbToUsd(twin.totalVolumeEth, usdPerBnb),
    volume24hUsd: convertBnbToUsd(twin.volume24hEth, usdPerBnb),
    volume1hUsd: convertBnbToUsd(twin.volume1hEth, usdPerBnb),
    lastPriceUsd: convertBnbToUsd(twin.lastPriceEth, usdPerBnb),
  }
}

function applyUsdToActivity(item: ActivityItem, usdPerBnb: number | null): ActivityItem {
  if (typeof usdPerBnb !== "number") {
    return {
      ...item,
      usdAmount: 0,
    }
  }

  return {
    ...item,
    usdAmount: convertBnbToUsd(item.ethAmount, usdPerBnb),
  }
}

function clampMetric(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function classifyWalletActivity(valueUsd: number): {
  tier: WalletActivityTier
  label: string
  icon: string
} {
  if (valueUsd < 200) {
    return { tier: "shrimp", label: "Shrimp activity", icon: "🐟" }
  }
  if (valueUsd < 5_000) {
    return { tier: "crab", label: "Crab activity", icon: "🦀" }
  }
  if (valueUsd < 50_000) {
    return { tier: "dolphin", label: "Dolphin activity", icon: "🐬" }
  }
  if (valueUsd < 500_000) {
    return { tier: "whale", label: "Whale activity", icon: "🐳" }
  }
  return { tier: "shark", label: "Shark activity", icon: "🦈" }
}

function toPercentChange(current: number, previous: number) {
  if (current <= 0 || previous <= 0) return 0
  return ((current - previous) / previous) * 100
}

function groupSnapshotsByTwin(
  snapshots: RawHourlySnapshot[],
  limitPerTwin: number
): Map<string, RawHourlySnapshot[]> {
  const snapshotsByTwin = new Map<string, RawHourlySnapshot[]>()
  for (const snapshot of snapshots) {
    const existing = snapshotsByTwin.get(snapshot.digitalTwin.id) ?? []
    if (existing.length < limitPerTwin) {
      existing.push(snapshot)
      snapshotsByTwin.set(snapshot.digitalTwin.id, existing)
    }
  }

  return snapshotsByTwin
}

function getHolderDeltaFromSnapshots(hourly: RawHourlySnapshot[]) {
  const latest = hourly[0]
  const previous = hourly[1]
  const latestActive = latest ? parseNumber(latest.activeHolders ?? "0") : 0
  const previousActive = previous ? parseNumber(previous.activeHolders ?? "0") : 0
  const holderDelta = latestActive - previousActive
  const holderGrowthPct =
    previousActive > 0 ? clampMetric((holderDelta / previousActive) * 100, -99.9, 999) : holderDelta > 0 ? 100 : 0

  return {
    latestActive,
    previousActive,
    holderDelta,
    holderGrowthPct,
  }
}

function classifyPriceVelocity(changePct: number, volumeSpikePct: number): "Low" | "Moderate" | "High" {
  const momentum = Math.abs(changePct)
  const spike = Math.abs(volumeSpikePct)

  if (momentum >= 12 || spike >= 180) return "High"
  if (momentum >= 4 || spike >= 60) return "Moderate"
  return "Low"
}

async function enrichMomentumSignals(twins: TwinSummary[]): Promise<TwinSummary[]> {
  if (twins.length === 0) {
    return []
  }

  const snapshots = (await fetchMomentumSnapshots(twins.map((twin) => twin.id)).catch(() => [])) as
    | RawHourlySnapshot[]
    | []

  const snapshotsByTwin = new Map<string, RawHourlySnapshot[]>()
  for (const snapshot of snapshots) {
    const existing = snapshotsByTwin.get(snapshot.digitalTwin.id) ?? []
    if (existing.length < 26) {
      existing.push(snapshot)
      snapshotsByTwin.set(snapshot.digitalTwin.id, existing)
    }
  }

  const bnbUsdPrice = await fetchBnbUsdPrice().catch(() => null)
  const whaleAddresses = [...new Set(
    twins
      .filter(
        (twin) =>
          twin.signal === "buy" &&
          typeof twin.lastTrader === "string" &&
          twin.lastTrader.startsWith("0x")
      )
      .map((twin) => twin.lastTrader as `0x${string}`)
  )]

  const whaleBalanceEntries = await Promise.all(
    whaleAddresses.map(async (address) => {
      const balance = await fetchAddressNativeBalance(address).catch(() => null)
      return [address, balance] as const
    })
  )
  const whaleBalanceMap = new Map(whaleBalanceEntries)

  return twins.map((twin) => {
    const hourly = snapshotsByTwin.get(twin.id) ?? []
    const latest = hourly[0]
    const previous = hourly[1]

    const latestClose = latest ? parseEth(latest.closePriceEth) : twin.lastPriceEth
    const previousClose = previous
      ? parseEth(previous.closePriceEth)
      : latest
        ? parseEth(latest.openPriceEth)
        : 0
    const { latest1hVolumeEth, rolling24hVolumeEth, volumeChange1hPct } =
      resolveHourlyVolumeMetrics(hourly)

    const momentumChangePct = clampMetric(
      toPercentChange(latestClose, previousClose),
      -99.9,
      999
    )

    const whaleData =
      twin.signal === "buy" && twin.lastTrader
        ? whaleBalanceMap.get(twin.lastTrader as `0x${string}`) ?? null
        : null
    const activityTierUsdValue =
      whaleData && typeof bnbUsdPrice === "number" ? whaleData.bnb * bnbUsdPrice : undefined
    const activityTier =
      typeof activityTierUsdValue === "number"
        ? classifyWalletActivity(activityTierUsdValue)
        : null

    return {
      ...twin,
      volume24hEth: rolling24hVolumeEth > 0 ? rolling24hVolumeEth : twin.volume24hEth,
      volume1hEth: latest1hVolumeEth,
      change1hPct: momentumChangePct,
      momentumChangePct,
      volumeSpikePct: volumeChange1hPct,
      activityTier: activityTier?.tier,
      activityTierLabel: activityTier?.label,
      activityTierIcon: activityTier?.icon,
      activityTierUsdValue,
      activityTierTrader: activityTier ? twin.lastTrader : undefined,
    }
  })
}

async function enrichLatestBuyActivityTier(twin: TwinSummary): Promise<TwinSummary> {
  if (twin.signal !== "buy" || !twin.lastTrader?.startsWith("0x")) {
    return twin
  }

  const [bnbUsdPrice, balance] = await Promise.all([
    fetchBnbUsdPrice().catch(() => null),
    fetchAddressNativeBalance(twin.lastTrader as `0x${string}`).catch(() => null),
  ])

  if (!balance || typeof bnbUsdPrice !== "number") {
    return twin
  }

  const activityTierUsdValue = balance.bnb * bnbUsdPrice
  const activityTier = classifyWalletActivity(activityTierUsdValue)

  return {
    ...twin,
    activityTier: activityTier.tier,
    activityTierLabel: activityTier.label,
    activityTierIcon: activityTier.icon,
    activityTierUsdValue,
    activityTierTrader: twin.lastTrader,
  }
}

async function enrichTwinMetadata(twin: TwinSummary): Promise<TwinSummary> {
  const metadata =
    (isDatabaseConfigured() ? await getCatalogMetadata(twin.id) : null) ??
    (await getTwinMetadata(twin.id, twin.metadataUrl))

  if (!metadata) {
    return twin
  }

  return {
    ...twin,
    displayName: metadata.name?.trim() || twin.displayName,
    avatarUrl: metadata.imageUrl,
    description: metadata.description,
  }
}

async function enrichTwinListMetadata(twins: TwinSummary[]): Promise<TwinSummary[]> {
  if (twins.length === 0) return []

  const dbMetadataMap = isDatabaseConfigured()
    ? await getCatalogMetadataMap(twins.map((twin) => twin.id))
    : {}
  const cacheMetadataMap = await getTwinMetadataBatch(
    twins
      .filter((twin) => !dbMetadataMap[twin.id])
      .map((twin) => ({ id: twin.id, metadataUrl: twin.metadataUrl }))
  )

  return twins.map((twin) => {
    const metadata = dbMetadataMap[twin.id] ?? cacheMetadataMap[twin.id]
    if (!metadata) return twin
    return {
      ...twin,
      displayName: metadata.name?.trim() || twin.displayName,
      avatarUrl: metadata.imageUrl,
      description: metadata.description,
    }
  })
}

async function enrichActivityNames(
  items: ActivityItem[],
  urlMap: Record<string, string | undefined>
): Promise<ActivityItem[]> {
  if (items.length === 0) return []

  const dbMetadataMap = isDatabaseConfigured()
    ? await getCatalogMetadataMap(items.map((item) => item.twinId))
    : {}
  const cacheMetadataMap = await getTwinMetadataBatch(
    items
      .filter((item) => !dbMetadataMap[item.twinId] && urlMap[item.twinId])
      .map((item) => ({ id: item.twinId, metadataUrl: urlMap[item.twinId] }))
  )

  return items.map((item) => {
    const metadata = dbMetadataMap[item.twinId] ?? cacheMetadataMap[item.twinId]
    return metadata?.name ? { ...item, twinDisplayName: metadata.name } : item
  })
}

async function fetchFreshHomepageBaseData(): Promise<HomepageBaseData> {
  const home = await fetchHomepageSubgraphData()
  if (!home) {
    throw new Error(getHomepageFailureMessage("Homepage market data returned no records."))
  }

  const usdPerBnb = await fetchBnbUsdPrice().catch((error) => {
    if (getBscRpcUrl()) {
      console.error("[homepage] BNB/USD price fetch failed:", error)
    }
    return null
  })
  const trades = (home?.recentTrades as RawTrade[] | undefined) ?? []
  const signals = buildTradeSignalMap(trades)

  const activityBase: ActivityItem[] = trades.map((trade) => ({
    id: trade.id,
    twinId: trade.digitalTwin.id,
    twinDisplayName: shortTwinLabel(trade.digitalTwin.id),
    trader: shortenAddress(trade.trader),
    isBuy: trade.isBuy,
    shareAmount: parseNumber(trade.shareAmount),
    ethAmount: parseEth(trade.ethAmount),
    usdAmount: 0,
    timestamp: Number(trade.blockTimestamp),
  }))

  const urlMap = Object.fromEntries(
    trades.map((trade) => [trade.digitalTwin.id, trade.digitalTwin.url ?? undefined])
  ) as Record<string, string | undefined>

  const activity = (await enrichActivityNames(activityBase, urlMap)).map((item) =>
    applyUsdToActivity(item, usdPerBnb)
  )

  const latestBase =
    (home?.recentlyActiveTwins as RawTwin[] | undefined)?.map((twin) => mapTwin(twin, signals)) ??
    []
  const trendingBase =
    (home?.trendingTwins as RawTwin[] | undefined)?.map((twin) => mapTwin(twin, signals)) ?? []
  const newBase =
    (home?.newTwins as RawTwin[] | undefined)?.map((twin) => mapTwin(twin, signals)) ?? []

  const allTwins = dedupeTwins([...latestBase, ...trendingBase, ...newBase])
  const metadataReadyAll = await enrichTwinListMetadata(allTwins)
  const momentumReadyAll = await enrichMomentumSignals(metadataReadyAll)
  const enrichedAll = momentumReadyAll.map((twin) => applyUsdToTwin(twin, usdPerBnb))
  const enrichedMap = Object.fromEntries(
    enrichedAll.map((twin) => [twin.id, twin])
  ) as Record<string, TwinSummary>

  const latestTwins = latestBase.map((twin) => enrichedMap[twin.id] ?? applyUsdToTwin(twin, usdPerBnb))
  const trendingTwins = trendingBase.map((twin) =>
    enrichedMap[twin.id] ?? applyUsdToTwin(twin, usdPerBnb)
  )
  const newTwins = newBase.map((twin) => enrichedMap[twin.id] ?? applyUsdToTwin(twin, usdPerBnb))
  const watchlist = latestTwins.slice(0, 3)

  return {
    totalTwins: home.protocolStats ? parseNumber(home.protocolStats.totalTwins) : 0,
    trendingTwins,
    latestTwins,
    newTwins,
    watchlist,
    activity,
  }
}

async function fetchBaseHomepageData(): Promise<HomepageBaseData> {
  const cached = await readHomepageBaseCache()

  if (cached?.snapshot && isHomepageCacheFresh(cached.lastSuccessAt)) {
    recordCacheEvent({
      cache: "homepage",
      outcome: "hit",
      ageMs: cached.lastSuccessAt ? Date.now() - Date.parse(cached.lastSuccessAt) : undefined,
    })
    return withHomepageStatus(cached.snapshot)
  }

  if (cached?.snapshot && hasActiveRetryWindow(cached.retryAfter)) {
    recordCacheEvent({
      cache: "homepage",
      outcome: "stale_served",
      ageMs: cached.lastSuccessAt ? Date.now() - Date.parse(cached.lastSuccessAt) : undefined,
      error: cached.lastError ?? undefined,
    })
    return withHomepageStatus(cached.snapshot, getCachedHomepageMessage(cached.lastError))
  }

  if (homepageBaseRefreshPromise) {
    if (cached?.snapshot) {
      recordCacheEvent({
        cache: "homepage",
        outcome: "stale_served",
        ageMs: cached.lastSuccessAt ? Date.now() - Date.parse(cached.lastSuccessAt) : undefined,
        error: cached.lastError ?? undefined,
      })
      return withHomepageStatus(cached.snapshot, getCachedHomepageMessage(cached.lastError))
    }

    return homepageBaseRefreshPromise
  }

  recordCacheEvent({
    cache: "homepage",
    outcome: "miss",
    ageMs: cached?.lastSuccessAt ? Date.now() - Date.parse(cached.lastSuccessAt) : undefined,
  })

  if (cached?.snapshot && canServeHomepageStale(cached.lastSuccessAt)) {
    const staleSnapshot = cached.snapshot

    if (!homepageBaseRefreshPromise) {
      homepageBaseRefreshPromise = withOpsTrace({
        name: "homepage_build",
        dependency: "app",
        task: async () => {
          try {
            const fresh = await fetchFreshHomepageBaseData()
            await writeHomepageBaseCache(fresh)
            recordCacheEvent({
              cache: "homepage",
              outcome: "refresh_success",
            })
            return fresh
          } catch (error) {
            console.error("[homepage] subgraph fetch failed:", error)
            recordCacheEvent({
              cache: "homepage",
              outcome: "refresh_failure",
              error,
            })

            const failureCount = Math.max(1, (cached.failureCount ?? 0) + 1)
            await writeHomepageBaseFailure(error, failureCount)
            return withHomepageStatus(staleSnapshot, getCachedHomepageMessage(error))
          } finally {
            homepageBaseRefreshPromise = null
          }
        },
      })
    }

    recordCacheEvent({
      cache: "homepage",
      outcome: "stale_served",
      ageMs: cached.lastSuccessAt ? Date.now() - Date.parse(cached.lastSuccessAt) : undefined,
      error: "stale-while-refresh",
    })
    return withHomepageStatus(
      staleSnapshot,
      cached.lastError ? getCachedHomepageMessage(cached.lastError) : getRefreshingHomepageMessage()
    )
  }

  homepageBaseRefreshPromise = withOpsTrace({
    name: "homepage_build",
    dependency: "app",
    task: async () => {
      try {
        const fresh = await fetchFreshHomepageBaseData()
        await writeHomepageBaseCache(fresh)
        recordCacheEvent({
          cache: "homepage",
          outcome: "refresh_success",
        })
        return fresh
      } catch (error) {
        console.error("[homepage] subgraph fetch failed:", error)
        recordCacheEvent({
          cache: "homepage",
          outcome: "refresh_failure",
          error,
        })

        const failureCount = Math.max(1, (cached?.failureCount ?? 0) + 1)
        await writeHomepageBaseFailure(error, failureCount)

        if (cached?.snapshot) {
          recordCacheEvent({
            cache: "homepage",
            outcome: "stale_served",
            ageMs: cached.lastSuccessAt ? Date.now() - Date.parse(cached.lastSuccessAt) : undefined,
            error,
          })
          return withHomepageStatus(cached.snapshot, getCachedHomepageMessage(error))
        }

        return emptyHomepageBaseData(getHomepageFailureMessage(error))
      } finally {
        homepageBaseRefreshPromise = null
      }
    },
  })

  return homepageBaseRefreshPromise
}

function scorePerformance(twin: TwinSummary): number {
  const recentBoost = twin.lastTradeAt ? twin.lastTradeAt / 1e7 : 0
  const sentimentBoost =
    twin.signal === "buy" ? 30 : twin.signal === "sell" ? -12 : 8

  return (
    twin.volume24hUsd * 120 +
    twin.totalTrades * 6 +
    twin.holders * 3 +
    twin.lastPriceUsd * 60 +
    recentBoost +
    sentimentBoost
  )
}

async function buildFeaturedCarousel(
  base: HomepageBaseData
): Promise<FeaturedTwin[]> {
  const override = await getFeaturedOverride()
  const envFeaturedId = getFeaturedTwinId()
  const fallbackTwin = base.latestTwins[0] ?? base.trendingTwins[0] ?? null
  const featuredId = override?.twinId || envFeaturedId || fallbackTwin?.id

  if (!featuredId) {
    return []
  }

  const source = override ? "admin" : envFeaturedId ? "env" : "auto"
  const sourceLabel = override?.label || (envFeaturedId ? "env default" : "auto spotlight")

  const baseTwin =
    [...base.latestTwins, ...base.trendingTwins, ...base.newTwins].find(
      (candidate) => candidate.id === featuredId
    ) ??
    (await getTwinDetail(featuredId)) ??
    fallbackTwin

  if (!baseTwin) {
    return []
  }

  const performanceTwins = dedupeTwins([...base.latestTwins, ...base.trendingTwins])
    .filter((twin) => twin.id !== baseTwin.id)
    .sort((left, right) => scorePerformance(right) - scorePerformance(left))
    .slice(0, 3)

  const carouselSeeds: Array<{
    twin: TwinSummary
    source: FeaturedTwin["source"]
    sourceLabel: string
  }> = [
    {
      twin: baseTwin,
      source,
      sourceLabel,
    },
    ...performanceTwins.map((twin, index) => ({
      twin,
      source: "performance" as const,
      sourceLabel: `performance leader ${index + 1}`,
    })),
  ]

  const hydratedSeeds = await Promise.all(
    carouselSeeds.map(async (item) => {
      const detailResult = await getTwinDetailResult(item.twin.id).catch(() => null)
      const refreshedTwin = detailResult?.twin ?? item.twin

      return {
        twin: refreshedTwin,
        quote: await getTwinQuote(item.twin.id).catch(() => null),
        source: item.source,
        sourceLabel: item.sourceLabel,
        displayName: refreshedTwin.displayName,
      } satisfies FeaturedTwin
    })
  )

  return hydratedSeeds
}

function cleanJsonBlock(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith("```")) {
    return trimmed
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
}

function parseAiInsights(content: string): CopilotInsight[] | null {
  try {
    const parsed = JSON.parse(cleanJsonBlock(content)) as
      | { insights?: Array<Record<string, unknown>> }
      | Array<Record<string, unknown>>

    const rawItems = Array.isArray(parsed) ? parsed : parsed.insights
    if (!Array.isArray(rawItems)) {
      return null
    }

    const insights = rawItems
      .map((item, index) => {
        const title = typeof item.title === "string" ? item.title.trim() : ""
        const body = typeof item.body === "string" ? item.body.trim() : ""
        const subject = typeof item.subject === "string" ? item.subject.trim() : ""
        const action = typeof item.action === "string" ? item.action.trim() : ""
        const label = typeof item.label === "string" ? item.label.trim() : ""
        const signals = Array.isArray(item.signals)
          ? item.signals
              .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
              .filter(Boolean)
          : []
        const tone = item.tone
        const resolvedTitle = subject || title
        const resolvedBody = action || body
        if (!resolvedTitle || !resolvedBody) return null
        return {
          id: String(item.id ?? index + 1),
          title: resolvedTitle,
          body: resolvedBody,
          tone:
            tone === "bullish" || tone === "bearish" || tone === "neutral"
              ? tone
              : "neutral",
          label: label || undefined,
          subject: subject || resolvedTitle,
          signals: signals.length > 0 ? signals.slice(0, 3) : undefined,
          action: action || resolvedBody,
        } satisfies CopilotInsight
      })
      .filter(Boolean) as CopilotInsight[]

    return insights.length > 0 ? insights.slice(0, 3) : null
  } catch {
    return null
  }
}

function parseAiSpotlightSelection(content: string): {
  selectedTwinIds: string[]
  lead: string
} | null {
  try {
    const parsed = JSON.parse(cleanJsonBlock(content)) as {
      selectedTwinIds?: unknown
      lead?: unknown
    }

    const selectedTwinIds = Array.isArray(parsed.selectedTwinIds)
      ? parsed.selectedTwinIds
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter(Boolean)
      : []
    const lead = typeof parsed.lead === "string" ? parsed.lead.trim() : ""

    if (selectedTwinIds.length === 0 || !lead) {
      return null
    }

    return {
      selectedTwinIds,
      lead,
    }
  } catch {
    return null
  }
}

function buildFallbackSpotlightLead(
  spotlightTwins: AiCopilotTwinCard[],
  verifiedNewHolders1h: number
): string {
  if (spotlightTwins.length === 0) {
    return "I am monitoring high-activity twins and standing by to explain holder flow, volume shifts, and breakout risk using indexed on-chain data."
  }

  if (spotlightTwins.length === 1) {
    const [card] = spotlightTwins
    return `${card.twin.displayName} is the current spotlight because it is leading the monitored set on short-term holder growth, indexed price movement, and volume activity. It added ${Math.max(card.holderDelta1h, 0)} net new holders in the last hour with a ${card.twin.change1hPct >= 0 ? "+" : ""}${card.twin.change1hPct.toFixed(1)}% indexed 1H price change.`
  }

  const names = spotlightTwins.map((card) => card.twin.displayName)
  return `${names[0]} and ${names[1]} are the current spotlight picks because they rose to the top of the monitored set on 1H holder growth, indexed price movement, and volume activity. Across the monitored pool, ${verifiedNewHolders1h.toLocaleString()} net new holders were added in the last hour.`
}

function buildActionableInsight(input: {
  id: string
  tone: "bullish" | "bearish" | "neutral"
  subject: string
  signals: string[]
  action: string
}): CopilotInsight {
  return {
    id: input.id,
    tone: input.tone,
    label:
      input.tone === "bullish"
        ? "AI PICK"
        : input.tone === "bearish"
          ? "AI RISK"
          : "AI WATCH",
    title: input.subject,
    body: input.action,
    subject: input.subject,
    signals: input.signals.slice(0, 3),
    action: input.action,
  }
}

function buildFallbackInsights(
  latestTwins: TwinSummary[],
  newTwins: TwinSummary[],
  activity: ActivityItem[]
): CopilotInsight[] {
  const netFlow = new Map<
    string,
    { name: string; flow: number; buys: number; sells: number; volume: number }
  >()

  for (const trade of activity) {
    const existing = netFlow.get(trade.twinId) ?? {
      name: trade.twinDisplayName,
      flow: 0,
      buys: 0,
      sells: 0,
      volume: 0,
    }
    existing.flow += trade.isBuy ? trade.usdAmount : -trade.usdAmount
    existing.volume += trade.usdAmount
    if (trade.isBuy) existing.buys += 1
    else existing.sells += 1
    netFlow.set(trade.twinId, existing)
  }

  const ranked = [...netFlow.entries()].sort((left, right) => right[1].flow - left[1].flow)
  const accumulation = ranked[0]
  const distribution = [...ranked].reverse()[0]
  const freshest = newTwins[0]
  const leader = latestTwins[0]
  const twinMap = new Map(
    [...latestTwins, ...newTwins].map((twin) => [twin.displayName, twin])
  )
  const averageVolume =
    ranked.length > 1
      ? ranked.reduce((sum, entry) => sum + entry[1].volume, 0) / ranked.length
      : 0

  function volumeSpike(value: number) {
    if (averageVolume <= 0) return 0
    return Math.max(0, Math.round(((value - averageVolume) / averageVolume) * 100))
  }

  function holderSignal(name: string) {
    const twin = twinMap.get(name)
    if (!twin) return "holder base still forming"
    if (twin.holders < 100) return "low holder count"
    if (twin.holders < 500) return "early holder base"
    return `${twin.holders.toLocaleString()} active holders`
  }

  function walletTierSignal(name: string) {
    const twin = twinMap.get(name)
    if (
      twin?.signal !== "buy" ||
      !twin.activityTierLabel ||
      typeof twin.activityTierUsdValue !== "number"
    ) {
      return "buy wallet size unclassified"
    }
    return `${twin.activityTierLabel.toLowerCase()} ${formatCompactUsd(twin.activityTierUsdValue)}`
  }

  const insights: CopilotInsight[] = []

  if (accumulation && accumulation[1].flow > 0) {
    insights.push(
      buildActionableInsight({
        id: "flow-up",
        tone: "bullish",
        subject: accumulation[1].name,
        signals: [
          `+${volumeSpike(accumulation[1].volume)}% volume spike`,
          "net buy pressure",
          walletTierSignal(accumulation[1].name),
          holderSignal(accumulation[1].name),
        ],
        action: "Early momentum detected",
      })
    )
  }

  if (distribution && distribution[1].flow < 0) {
    insights.push(
      buildActionableInsight({
        id: "flow-down",
        tone: "bearish",
        subject: distribution[1].name,
        signals: [
          `${formatCompactUsd(Math.abs(distribution[1].flow))} net outflow`,
          "sell pressure rising",
          holderSignal(distribution[1].name),
        ],
        action: "Risk-off behavior detected",
      })
    )
  }

  if (freshest) {
    insights.push(
      buildActionableInsight({
        id: "fresh-launch",
        tone: "neutral",
        subject: freshest.displayName,
        signals: [
          `${freshest.ageLabel} old`,
          `${freshest.totalTrades.toLocaleString()} indexed trades`,
          holderSignal(freshest.displayName),
        ],
        action: "Fresh setup worth monitoring",
      })
    )
  } else if (leader) {
    insights.push(
      buildActionableInsight({
        id: "leader",
        tone: "neutral",
        subject: leader.displayName,
        signals: [
          `${leader.totalTrades.toLocaleString()} total trades`,
          `${formatCompactUsd(leader.volume24hUsd)} volume`,
          holderSignal(leader.displayName),
        ],
        action: "Still leading current market attention",
      })
    )
  }

  return insights.slice(0, 3)
}

function parseTwinDetailInsight(content: string): TwinDetailInsight | null {
  try {
    const parsed = JSON.parse(cleanJsonBlock(content)) as unknown
    const parsedObject =
      parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
    const rawCandidate =
      parsedObject?.insight && typeof parsedObject.insight === "object"
        ? (parsedObject.insight as Record<string, unknown>)
        : parsedObject

    if (!rawCandidate) {
      return null
    }

    const label = typeof rawCandidate.label === "string" ? rawCandidate.label.trim() : ""
    const headline =
      typeof rawCandidate.headline === "string" ? rawCandidate.headline.trim() : ""
    const summary = typeof rawCandidate.summary === "string" ? rawCandidate.summary.trim() : ""
    const action = typeof rawCandidate.action === "string" ? rawCandidate.action.trim() : ""
    const tone = rawCandidate.tone
    const signals = Array.isArray(rawCandidate.signals)
      ? rawCandidate.signals
          .map((entry: unknown) => (typeof entry === "string" ? entry.trim() : ""))
          .filter(Boolean)
          .slice(0, 4)
      : []
    const stats: TwinDetailInsightStat[] = []
    if (Array.isArray(rawCandidate.stats)) {
      for (const entry of rawCandidate.stats) {
        if (!entry || typeof entry !== "object") continue
        const item = entry as Record<string, unknown>
        const statLabel = typeof item.label === "string" ? item.label.trim() : ""
        const value = typeof item.value === "string" ? item.value.trim() : ""
        const statTone = item.tone
        if (!statLabel || !value) continue
        stats.push({
          label: statLabel,
          value,
          tone:
            statTone === "bullish" || statTone === "bearish" || statTone === "neutral"
              ? statTone
              : undefined,
        })
        if (stats.length >= 4) break
      }
    }

    if (!label || !headline || !summary || !action) {
      return null
    }

    return {
      label,
      headline,
      summary,
      action,
      signals,
      stats,
      tone:
        tone === "bullish" || tone === "bearish" || tone === "neutral"
          ? tone
          : "neutral",
    }
  } catch {
    return null
  }
}

function buildTwinDetailFallbackInsight(input: {
  twin: TwinSummary
  chart: TwinChartPoint[]
  trades: TwinDetailTrade[]
  holders: TwinDetailHolder[]
}): TwinDetailInsight {
  const { twin, chart, trades, holders } = input
  const latestBar = chart[chart.length - 1]
  const previousBar = chart[chart.length - 2]
  const recentTrades = trades.slice(0, 8)
  const buyCount = recentTrades.filter((trade) => trade.isBuy).length
  const sellCount = recentTrades.length - buyCount
  const netFlowUsd = recentTrades.reduce(
    (sum, trade) => sum + (trade.isBuy ? trade.usdAmount : -trade.usdAmount),
    0
  )
  const volumeChangePct =
    latestBar && previousBar && previousBar.volumeUsd > 0
      ? clampMetric(
          ((latestBar.volumeUsd - previousBar.volumeUsd) / previousBar.volumeUsd) * 100,
          -99.9,
          999
        )
      : latestBar?.volumeUsd
        ? 100
        : 0
  const activeHolderDelta =
    latestBar && previousBar ? latestBar.activeHolders - previousBar.activeHolders : 0
  const topHolderShare = holders[0]?.sharePct ?? 0
  const recentTier =
    twin.signal === "buy" && twin.activityTierLabel && typeof twin.activityTierUsdValue === "number"
      ? `${twin.activityTierIcon || ""} ${twin.activityTierLabel} ${formatCompactUsd(
          twin.activityTierUsdValue
        )}`.trim()
      : "Latest buy wallet not classified"

  const bullish =
    twin.change1hPct >= 0 && netFlowUsd >= 0 && (buyCount > sellCount || volumeChangePct > 20)
  const bearish =
    twin.change1hPct < 0 && netFlowUsd < 0 && (sellCount > buyCount || volumeChangePct < -15)

  const tone: TwinDetailInsight["tone"] = bullish ? "bullish" : bearish ? "bearish" : "neutral"
  const label = bullish ? "AI PICK" : bearish ? "AI RISK" : "AI WATCH"
  const headline = bullish
    ? `${twin.displayName} is attracting fresh demand`
    : bearish
      ? `${twin.displayName} is showing distribution pressure`
      : `${twin.displayName} is consolidating around current flow`
  const summary = bullish
    ? `Buy flow is leading recent activity, with ${formatCompactUsd(
        Math.abs(netFlowUsd)
      )} of net inflow and ${volumeChangePct >= 0 ? "expanding" : "steady"} hourly participation.`
    : bearish
      ? `Recent sells are outweighing buys, leaving ${formatCompactUsd(
          Math.abs(netFlowUsd)
        )} of net outflow and softer short-term price action.`
      : `Flow is mixed, but the twin is still printing ${formatCompactUsd(
          latestBar?.volumeUsd ?? 0
        )} in the latest indexed hour with holders continuing to rotate.`
  const action = bullish
    ? "Momentum is live. Watch for follow-through above the latest price zone before sizing up."
    : bearish
      ? "Let sellers finish. Wait for buy flow to reclaim the tape before chasing entries."
      : "Treat this as a watch setup. A break in net flow or hourly volume should decide direction."

  return {
    label,
    tone,
    headline,
    summary,
    action,
    signals: [
      `${twin.change1hPct >= 0 ? "+" : ""}${twin.change1hPct.toFixed(1)}% indexed 1H change`,
      `${volumeChangePct >= 0 ? "+" : ""}${volumeChangePct.toFixed(0)}% volume shift`,
      `${buyCount} buys vs ${sellCount} sells`,
      recentTier,
    ],
    stats: [
      {
        label: "1H Volume",
        value: formatCompactUsd(latestBar?.volumeUsd ?? 0),
        tone: latestBar?.volumeUsd ? "bullish" : "neutral",
      },
      {
        label: "Net Flow",
        value: `${netFlowUsd >= 0 ? "+" : "-"}${formatCompactUsd(Math.abs(netFlowUsd))}`,
        tone: netFlowUsd > 0 ? "bullish" : netFlowUsd < 0 ? "bearish" : "neutral",
      },
      {
        label: "Top Holder",
        value: `${topHolderShare.toFixed(1)}%`,
        tone: topHolderShare > 15 ? "bearish" : "neutral",
      },
      {
        label: "Holder Drift",
        value: `${activeHolderDelta >= 0 ? "+" : ""}${activeHolderDelta}`,
        tone: activeHolderDelta > 0 ? "bullish" : activeHolderDelta < 0 ? "bearish" : "neutral",
      },
    ],
  }
}

function emptyTwinQuote(id: string): TwinQuote {
  return {
    twinId: id,
    amount: "1",
    buyQuoteWei: "0",
    sellQuoteWei: "0",
    buyQuoteEth: "0",
    sellQuoteEth: "0",
    buyQuoteUsd: "0.00",
    sellQuoteUsd: "0.00",
    feeSharePct: "0.00",
    holderBalance: "0",
    holderBalanceWei: "0",
  }
}

async function buildUnavailableTwinDetailSnapshot(
  id: string,
  error: string
): Promise<TwinDetailSnapshot> {
  const baseHomepage = await fetchBaseHomepageData().catch(() => emptyHomepageBaseData())
  const twin: TwinSummary = {
    id,
    displayName: shortTwinLabel(id),
    owner: "Unavailable",
    metadataUrl: undefined,
    avatarUrl: undefined,
    description: "TradeKeys could not refresh this twin's market data right now.",
    supply: 0,
    holders: 0,
    totalTrades: 0,
    totalVolumeEth: 0,
    totalVolumeUsd: 0,
    volume24hEth: 0,
    volume24hUsd: 0,
    volume1hEth: 0,
    volume1hUsd: 0,
    lastPriceEth: 0,
    lastPriceUsd: 0,
    change1hPct: 0,
    ageLabel: "0m",
    signal: "watch",
  }

  return {
    twin,
    quote: emptyTwinQuote(id),
    chart: [],
    trades: [],
    holders: [],
    insight: {
      label: "AI WATCH",
      headline: "Market data temporarily unavailable",
      summary: "This twin's indexed market feed is temporarily unavailable, so TradeKeys is holding the last known state instead of showing a false 404.",
      action: "Retry shortly. Trading can still proceed if live quotes are available.",
      signals: ["Subgraph refresh delayed", "No confirmed latest candle", "Using safe degraded mode"],
      tone: "neutral",
      stats: [
        {
          label: "Status",
          value: "Delayed",
          tone: "neutral",
        },
      ],
    },
    newLaunches: baseHomepage.newTwins.slice(0, 4),
    error,
  }
}

async function getTwinDetailInsight(input: {
  twin: TwinSummary
  chart: TwinChartPoint[]
  trades: TwinDetailTrade[]
  holders: TwinDetailHolder[]
  newLaunches: TwinSummary[]
}): Promise<TwinDetailInsight> {
  const fallback = buildTwinDetailFallbackInsight(input)

  if (!getOpenGradientPrivateKey()) {
    return fallback
  }

  try {
    const prompt = [
      "Generate one detail-page copilot insight for TradeKeys.",
      'Return strict JSON with shape {"insight":{"label":"AI PICK","headline":"...","summary":"...","action":"...","tone":"bullish|bearish|neutral","signals":["..."],"stats":[{"label":"1H Volume","value":"...","tone":"bullish|bearish|neutral"}]}} and nothing else.',
      "Use only the supplied twin detail data. Keep the tone direct and actionable.",
      JSON.stringify({
        twin: {
          id: input.twin.id,
          displayName: input.twin.displayName,
          holders: input.twin.holders,
          totalTrades: input.twin.totalTrades,
          totalVolumeUsd: Number(input.twin.totalVolumeUsd.toFixed(2)),
          volume24hUsd: Number(input.twin.volume24hUsd.toFixed(2)),
          volume1hUsd: Number(input.twin.volume1hUsd.toFixed(2)),
          lastPriceUsd: Number(input.twin.lastPriceUsd.toFixed(4)),
          change1hPct: Number(input.twin.change1hPct.toFixed(2)),
          activityTierLabel: input.twin.activityTierLabel,
          activityTierUsdValue:
            typeof input.twin.activityTierUsdValue === "number"
              ? Number(input.twin.activityTierUsdValue.toFixed(2))
              : null,
        },
        latestBars: input.chart.slice(-6).map((bar) => ({
          time: bar.time,
          closeUsd: Number(bar.closeUsd.toFixed(4)),
          volumeUsd: Number(bar.volumeUsd.toFixed(2)),
          trades: bar.trades,
          activeHolders: bar.activeHolders,
        })),
        recentTrades: input.trades.slice(0, 8).map((trade) => ({
          isBuy: trade.isBuy,
          usdAmount: Number(trade.usdAmount.toFixed(2)),
          shareAmount: trade.shareAmount,
          trader: trade.trader,
          timestamp: trade.timestamp,
        })),
        topHolders: input.holders.slice(0, 5).map((holder) => ({
          holder: holder.holder,
          sharePct: Number(holder.sharePct.toFixed(2)),
          balance: holder.balance,
        })),
        newLaunches: input.newLaunches.slice(0, 3).map((launch) => ({
          id: launch.id,
          displayName: launch.displayName,
          ageLabel: launch.ageLabel,
        })),
      }),
    ].join("\n")

    const result = (await Promise.race([
      summarizeWithOpenGradient({
        prompt,
        twins: [input.twin, ...input.newLaunches.slice(0, 2)],
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Detail insight generation timed out")), 15000)
      }),
    ])) as Awaited<ReturnType<typeof summarizeWithOpenGradient>>

    return parseTwinDetailInsight(result.content) ?? fallback
  } catch {
    return fallback
  }
}

export async function getAppMeta(): Promise<AppMeta> {
  const base = await fetchBaseHomepageData()
  return { totalTwins: base.totalTwins }
}

export async function getTrendingTwins(): Promise<TwinSummary[]> {
  const base = await fetchBaseHomepageData()
  return base.trendingTwins
}

export async function getLatestActivityTwins(): Promise<TwinSummary[]> {
  const base = await fetchBaseHomepageData()
  return base.latestTwins
}

export async function getNewTwins(): Promise<TwinSummary[]> {
  const base = await fetchBaseHomepageData()
  return base.newTwins
}

export async function getWatchlistTwins(): Promise<TwinSummary[]> {
  const base = await fetchBaseHomepageData()
  return base.watchlist
}

export async function getWatchlistTwinsForAccount(account: string): Promise<TwinSummary[]> {
  const ids = await listWatchlistTwinIds(account)
  if (ids.length === 0) return []

  const resolved = await Promise.all(ids.map((id) => getTwinDetail(id).catch(() => null)))
  return resolved.filter((item): item is TwinSummary => Boolean(item))
}

function buildWatchlistTrend(chart: TwinChartPoint[], fallbackPrice: number) {
  const closes = chart
    .slice(-8)
    .map((point) => Number(point.closeUsd.toFixed(2)))
    .filter((value) => Number.isFinite(value) && value >= 0)

  if (closes.length >= 2) {
    return closes
  }

  const safeFallback = Number.isFinite(fallbackPrice) ? fallbackPrice : 0
  return [safeFallback * 0.94, safeFallback * 0.97, safeFallback].map((value) =>
    Number(Math.max(value, 0).toFixed(2))
  )
}

function resolveWatchlistFeedError(errors: string[]) {
  if (errors.length === 0) return undefined

  const cached = errors.find((entry) => entry.toLowerCase().includes("cached"))
  if (cached) return cached

  const rateLimited = errors.find((entry) => /\b429\b|rate-limit|rate limit/i.test(entry))
  if (rateLimited) return rateLimited

  return errors[0]
}

export async function getWatchlistDashboardForAccount(
  account: string
): Promise<WatchlistDashboardSnapshot> {
  const ids = await listWatchlistTwinIds(account)
  if (ids.length === 0) {
    return { items: [] }
  }

  const results = await Promise.allSettled(
    ids.map(async (id) => {
      const snapshot = await getTwinDetailSnapshot(id)
      if (!snapshot) {
        return null
      }

      const currentPriceUsd = Number(snapshot.twin.lastPriceUsd.toFixed(4))
      const referenceHourPriceUsd = snapshot.chart[snapshot.chart.length - 2]?.closeUsd ?? currentPriceUsd
      const liveQuoteBuyUsd = Number(snapshot.quote.buyQuoteUsd)
      const hasLiveQuote =
        Number.isFinite(liveQuoteBuyUsd) && liveQuoteBuyUsd > 0 && referenceHourPriceUsd > 0
      const change1hPct = hasLiveQuote
        ? Number(
            (((liveQuoteBuyUsd - referenceHourPriceUsd) / referenceHourPriceUsd) * 100).toFixed(2)
          )
        : Number(snapshot.twin.change1hPct.toFixed(2))
      const indexed24hTrades = snapshot.chart.slice(-24).reduce((sum, point) => sum + point.trades, 0)
      const hasFull24hTradeWindow = snapshot.chart.length >= 24

      const item: WatchlistDashboardItem = {
        twin: snapshot.twin,
        quote: snapshot.quote,
        insight: snapshot.insight,
        currentPriceUsd,
        change1hPct,
        change1hSource: hasLiveQuote ? "live" : "indexed",
        trend: buildWatchlistTrend(
          snapshot.chart,
          currentPriceUsd
        ),
        volume1hUsd: snapshot.twin.volume1hUsd,
        trades24h: indexed24hTrades,
        tradeCountValue: hasFull24hTradeWindow ? indexed24hTrades : snapshot.twin.totalTrades,
        tradeCountLabel: hasFull24hTradeWindow ? "Indexed 24H trades" : "Indexed total trades",
        ...(snapshot.error ? { error: snapshot.error } : {}),
      }

      return item
    })
  )

  const items = results
    .flatMap((result) => {
      if (result.status === "fulfilled") {
        return result.value ? [result.value] : []
      }

      console.error("[watchlist] dashboard item failed:", result.reason)
      return []
    })
    .filter((item): item is WatchlistDashboardItem => Boolean(item))

  const itemErrors = items.flatMap((item) => (item.error ? [item.error] : []))
  const rejectedErrors = results.flatMap((result) =>
    result.status === "rejected"
      ? [
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason ?? "Failed to build watchlist dashboard."),
        ]
      : []
  )
  const error = resolveWatchlistFeedError([...itemErrors, ...rejectedErrors])

  return error ? { items, error } : { items }
}

export async function getTwinDetailResult(id: string): Promise<{
  twin: TwinSummary | null
  error?: string
  unavailable?: boolean
}> {
  const { payload, error, unavailable } = await fetchCachedTwinDetailPayload(id)
  const raw = payload?.digitalTwin as RawTwinDetail | null | undefined
  if (!raw) {
    return { twin: null, ...(error ? { error, unavailable } : {}) }
  }

  const hourlySnapshots = ((payload?.hourlySnapshots as RawHourlySnapshot[] | undefined) ?? []).sort(
    (left, right) => Number(right.bucketStart) - Number(left.bucketStart)
  )
  const { latest1hVolumeEth, rolling24hVolumeEth } = resolveHourlyVolumeMetrics(hourlySnapshots)
  const base = {
    ...mapTwin(raw, new Map()),
    change1hPct: resolveHourlyChange(hourlySnapshots),
    volume24hEth: rolling24hVolumeEth,
    volume1hEth: latest1hVolumeEth,
  }
  const live = await fetchLiveTwinOwnerAndUrl(id).catch(() => null)
  const merged = {
    ...base,
    owner: live?.owner ? String(live.owner) : base.owner,
    metadataUrl: live?.url ? String(live.url) : base.metadataUrl,
    supply: live?.supply ? Number(live.supply) : base.supply,
  }
  const usdPerBnb = await fetchBnbUsdPrice().catch(() => null)
  const withUsd = applyUsdToTwin(merged, usdPerBnb)
  const withActivityTier = await enrichLatestBuyActivityTier(withUsd)
  return {
    twin: await enrichTwinMetadata(withActivityTier),
    ...(error ? { error } : {}),
  }
}

export async function getTwinDetail(id: string): Promise<TwinSummary | null> {
  const result = await getTwinDetailResult(id)
  return result.twin
}

export async function getTwinDetailSnapshot(id: string): Promise<TwinDetailSnapshot | null> {
  return withOpsTrace({
    name: "twin_detail_build",
    dependency: "app",
    data: { twinId: id },
    task: async () => {
      const { payload, error, unavailable } = await fetchCachedTwinDetailPayload(id)
      const raw = payload?.digitalTwin as RawTwinDetail | null | undefined
      if (!raw) {
        if (unavailable && error) {
          return buildUnavailableTwinDetailSnapshot(id, error)
        }
        return null
      }

      const [live, usdPerBnb, quote, baseHomepage] = await Promise.all([
        fetchLiveTwinOwnerAndUrl(id).catch(() => null),
        fetchBnbUsdPrice().catch(() => null),
        getTwinQuote(id).catch(() => null),
        fetchBaseHomepageData().catch(() => null),
      ])

      const hourlySnapshots = ((payload?.hourlySnapshots as RawHourlySnapshot[] | undefined) ?? [])
        .slice()
        .sort((left, right) => Number(left.bucketStart) - Number(right.bucketStart))
      const newestFirstHourlies = [...hourlySnapshots].sort(
        (left, right) => Number(right.bucketStart) - Number(left.bucketStart)
      )
      const { latest1hVolumeEth, rolling24hVolumeEth } =
        resolveHourlyVolumeMetrics(newestFirstHourlies)

      const baseTwin = {
        ...mapTwin(raw, new Map()),
        change1hPct: resolveHourlyChange(newestFirstHourlies),
        volume24hEth: rolling24hVolumeEth,
        volume1hEth: latest1hVolumeEth,
      }
      const mergedTwin = {
        ...baseTwin,
        owner: live?.owner ? String(live.owner) : baseTwin.owner,
        metadataUrl: live?.url ? String(live.url) : baseTwin.metadataUrl,
        supply: live?.supply ? Number(live.supply) : baseTwin.supply,
      }

      const usdTwin = applyUsdToTwin(mergedTwin, usdPerBnb)
      const twin = await enrichTwinMetadata(await enrichLatestBuyActivityTier(usdTwin))
      const chart = hourlySnapshots.map((snapshot) => mapChartPoint(snapshot, usdPerBnb))
      const trades = (raw.trades ?? []).map((trade) => mapDetailTrade(trade, usdPerBnb))
      const holders = (raw.holders ?? []).map((holder) => mapDetailHolder(holder, twin.supply))
      const newLaunches = (baseHomepage?.newTwins ?? []).filter((launch) => launch.id !== id).slice(0, 4)
      const insight = await getTwinDetailInsight({
        twin,
        chart,
        trades,
        holders,
        newLaunches,
      })

      return {
        twin,
        quote: quote ?? emptyTwinQuote(id),
        chart,
        trades,
        holders,
        insight,
        newLaunches,
        ...(error ? { error } : {}),
      }
    },
  })
}

export async function getTwinQuote(
  id: string,
  amount = 1n,
  wallet?: `0x${string}`
): Promise<TwinQuote | null> {
  const live = await fetchLiveTwinQuote(id, amount, wallet).catch(() => null)
  if (!live) {
    return null
  }
  return {
    twinId: live.twinId,
    amount: live.amount,
    buyQuoteWei: live.buyQuoteWei,
    sellQuoteWei: live.sellQuoteWei,
    buyQuoteEth: live.buyQuoteEth,
    sellQuoteEth: live.sellQuoteEth,
    buyQuoteUsd: live.buyQuoteUsd,
    sellQuoteUsd: live.sellQuoteUsd,
    feeSharePct: live.feeSharePct,
    holderBalance: live.holderBalance,
    holderBalanceWei: live.holderBalanceWei,
  }
}

export async function getFeaturedTwin(): Promise<FeaturedTwin | null> {
  const base = await fetchBaseHomepageData()
  const carousel = await buildFeaturedCarousel(base)
  return carousel[0] ?? null
}

function getAiHealthSnapshot(base: HomepageBaseData): AiHealthSnapshot {
  if (!getOpenGradientPrivateKey()) {
    return {
      status: "unavailable",
      label: "AI unavailable",
      detail: "Set OPENGRADIENT_PRIVATE_KEY to enable verifiable AI responses.",
    }
  }

  if (!getSubgraphUrl()) {
    return {
      status: "degraded",
      label: "AI configured, context limited",
      detail: "OpenGradient is configured, but market context is reduced until SUBGRAPH_URL is restored.",
    }
  }

  if (base.error) {
    return {
      status: "degraded",
      label: "AI ready, market feed delayed",
      detail: "AI is configured, but current market context is relying on cached or degraded feed data.",
    }
  }

  return {
    status: "ready",
    label: "AI ready",
    detail: "OpenGradient and indexed market context are both available.",
  }
}

async function buildAiSpotlightData(base: HomepageBaseData, useAiSelection = false): Promise<{
  openingLead: string
  spotlightTwins: AiCopilotTwinCard[]
  contextTwins: TwinSummary[]
  verifiedNewHolders1h: number
}> {
  const contextTwins = dedupeTwins([...base.latestTwins, ...base.newTwins, ...base.trendingTwins]).slice(0, 8)
  if (contextTwins.length === 0) {
    return {
      openingLead:
        "I am monitoring high-activity twins and standing by to explain holder flow, volume shifts, and breakout risk using indexed on-chain data.",
      spotlightTwins: [],
      contextTwins: [],
      verifiedNewHolders1h: 0,
    }
  }

  const snapshots = (await fetchMomentumSnapshots(contextTwins.map((twin) => twin.id)).catch(() => [])) as
    | RawHourlySnapshot[]
    | []
  const snapshotsByTwin = groupSnapshotsByTwin(snapshots, 2)

  const spotlightPool = contextTwins.map((twin) => {
    const hourly = snapshotsByTwin.get(twin.id) ?? []
    const { holderDelta, holderGrowthPct } = getHolderDeltaFromSnapshots(hourly)
    const priceVelocity = classifyPriceVelocity(
      twin.momentumChangePct ?? twin.change1hPct,
      twin.volumeSpikePct ?? 0
    )
    const strengthScore = clampMetric(
      Math.abs(twin.change1hPct) * 3 + Math.max(holderDelta, 0) * 4 + Math.max(twin.volumeSpikePct ?? 0, 0) * 0.35,
      12,
      100
    )

    return {
      twin,
      holderDelta1h: holderDelta,
      holderGrowth1hPct: holderGrowthPct,
      priceVelocity,
      strengthPct: strengthScore,
      evidence: [
        `${holderDelta >= 0 ? "+" : ""}${holderDelta} holders (1h)`,
        `${twin.change1hPct >= 0 ? "+" : ""}${twin.change1hPct.toFixed(1)}% price change`,
        `${(twin.volumeSpikePct ?? 0) >= 0 ? "+" : ""}${(twin.volumeSpikePct ?? 0).toFixed(0)}% volume shift`,
        `${twin.holders.toLocaleString()} holders`,
      ],
    } satisfies AiCopilotTwinCard
  })

  const rankedSpotlights = [...spotlightPool]
    .sort((left, right) => {
      return (
        right.holderDelta1h - left.holderDelta1h ||
        right.holderGrowth1hPct - left.holderGrowth1hPct ||
        (right.twin.volumeSpikePct ?? 0) - (left.twin.volumeSpikePct ?? 0) ||
        right.twin.volume24hUsd - left.twin.volume24hUsd
      )
    })

  const verifiedNewHolders1h = spotlightPool.reduce(
    (sum, item) => sum + Math.max(0, item.holderDelta1h),
    0
  )

  let spotlightTwins = rankedSpotlights.slice(0, 2)
  let openingLead = buildFallbackSpotlightLead(spotlightTwins, verifiedNewHolders1h)

  if (useAiSelection && Boolean(getOpenGradientPrivateKey())) {
    try {
      const candidateCards = rankedSpotlights.slice(0, 6)
      const prompt = [
        "You are choosing the opening spotlight cards for the TradeKeys AI Copilot page.",
        "Select the strongest current twins from the supplied candidates and explain why they were selected.",
        "Return strict JSON with shape {\"selectedTwinIds\":[\"0x...\",\"0x...\"],\"lead\":\"...\"} and nothing else.",
        "Rules:",
        "- Select up to 2 twin IDs from the supplied candidate list only.",
        "- The lead must be 1-2 sentences and must describe the exact twins you selected.",
        "- Use only supplied metrics such as holderDelta1h, holderGrowth1hPct, change1hPct, volumeSpikePct, holders, supply, priceVelocity, and strengthPct.",
        "- Do not claim unsupported facts such as launch age, latest block transactions, or holder thresholds unless those facts appear in the payload.",
        "- Speak as the AI selecting the spotlight, not as a generic narrator.",
        JSON.stringify({
          verifiedNewHolders1h,
          candidates: candidateCards.map((card) => ({
            twinId: card.twin.id,
            displayName: card.twin.displayName,
            holders: card.twin.holders,
            supply: card.twin.supply,
            holderDelta1h: card.holderDelta1h,
            holderGrowth1hPct: Number(card.holderGrowth1hPct.toFixed(2)),
            change1hPct: Number(card.twin.change1hPct.toFixed(2)),
            volumeSpikePct: Number((card.twin.volumeSpikePct ?? 0).toFixed(2)),
            volume24hUsd: Number(card.twin.volume24hUsd.toFixed(2)),
            priceVelocity: card.priceVelocity,
            strengthPct: Number(card.strengthPct.toFixed(1)),
          })),
        }),
      ].join("\n")

      const result = (await Promise.race([
        summarizeWithOpenGradient({
          prompt,
          twins: candidateCards.map((card) => card.twin),
        }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("Spotlight selection timed out")), 15000)
        }),
      ])) as Awaited<ReturnType<typeof summarizeWithOpenGradient>>

      const parsed = parseAiSpotlightSelection(result.content)
      if (parsed) {
        const selected = parsed.selectedTwinIds
          .map((id) => candidateCards.find((card) => card.twin.id.toLowerCase() === id.toLowerCase()) ?? null)
          .filter(Boolean) as AiCopilotTwinCard[]

        if (selected.length > 0) {
          spotlightTwins = selected.slice(0, 2)
          openingLead = parsed.lead
        }
      }
    } catch {
      // keep deterministic spotlight and lead
    }
  }

  return {
    openingLead,
    spotlightTwins,
    contextTwins,
    verifiedNewHolders1h,
  }
}

function buildAiSuggestedPrompts(
  spotlightTwins: AiCopilotTwinCard[],
  verifiedNewHolders1h: number
): string[] {
  const primary = spotlightTwins[0]
  const secondary = spotlightTwins[1]

  return [
    primary
      ? `Analyze activity for ${primary.twin.displayName} and explain the ${primary.holderDelta1h >= 0 ? "holder inflow" : "holder loss"} in the last hour.`
      : "Analyze the top active twin and explain the latest holder and volume shifts.",
    primary && secondary
      ? `Compare ${primary.twin.displayName} versus ${secondary.twin.displayName} using holders, price change, and volume shift.`
      : "Compare the top two active twins using holders, price change, and volume shift.",
    `Scan for breakout twins supported by verified 1h holder growth. Current verified total: ${verifiedNewHolders1h}.`,
    "Run a risk scan for twins showing price weakness, sell pressure, or fading holder participation.",
  ]
}

export async function getAiCopilotSnapshot(options?: {
  includeInsights?: boolean
}): Promise<AiCopilotSnapshot> {
  const base = await fetchBaseHomepageData()
  const includeInsights = options?.includeInsights ?? true
  const [insights, spotlight] = await Promise.all([
    includeInsights ? buildCopilotInsights(base) : Promise.resolve<CopilotInsight[]>([]),
    buildAiSpotlightData(base, includeInsights),
  ])
  const suggestedPrompts = buildAiSuggestedPrompts(
    spotlight.spotlightTwins,
    spotlight.verifiedNewHolders1h
  )

  return {
    totalTwins: base.totalTwins,
    aiHealth: getAiHealthSnapshot(base),
    verifiedNewHolders1h: spotlight.verifiedNewHolders1h,
    monitoredTwinCount: spotlight.contextTwins.length,
    openingLead: spotlight.openingLead,
    spotlightTwins: spotlight.spotlightTwins,
    contextTwins: spotlight.contextTwins,
    insights,
    suggestedPrompts,
    ...(base.error ? { feedError: base.error } : {}),
  }
}

async function buildCopilotInsights(base: HomepageBaseData): Promise<CopilotInsight[]> {
  const fallback = buildFallbackInsights(base.latestTwins, base.newTwins, base.activity)
  const hasOpenGradient = Boolean(getOpenGradientPrivateKey())

  if (!hasOpenGradient) {
    return fallback
  }

  try {
    const prompt = [
      "Generate exactly 3 homepage market insights for TradeKeys.",
      "Return strict JSON with shape {\"insights\":[{\"id\":\"1\",\"label\":\"AI PICK\",\"subject\":\"...\",\"signals\":[\"...\",\"...\",\"...\"],\"action\":\"...\",\"tone\":\"bullish|bearish|neutral\"}]} and nothing else.",
      "Use only the supplied twin data and this recent activity snapshot.",
      "If a twin includes activityTierLabel or activityTierUsdValue, use that wallet-size signal as part of the analysis when it is relevant.",
      JSON.stringify(
        base.activity.slice(0, 8).map((item) => ({
          twin: item.twinDisplayName,
          isBuy: item.isBuy,
          shareAmount: item.shareAmount,
          usdAmount: Number(item.usdAmount.toFixed(2)),
          timestamp: item.timestamp,
        }))
      ),
    ].join("\n")

    const result = (await Promise.race([
      summarizeWithOpenGradient({
        prompt,
        twins: dedupeTwins([...base.latestTwins, ...base.trendingTwins]).slice(0, 8),
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Insight generation timed out")), 15000)
      }),
    ])) as Awaited<ReturnType<typeof summarizeWithOpenGradient>>

    const parsed = parseAiInsights(result.content)
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

export async function getCopilotInsights(): Promise<CopilotInsight[]> {
  const base = await fetchBaseHomepageData()
  return buildCopilotInsights(base)
}

export async function getHomepageActivity(): Promise<ActivityItem[]> {
  const base = await fetchBaseHomepageData()
  return base.activity
}

export async function getHomepageSnapshot(options?: {
  includeInsights?: boolean
}): Promise<HomepageSnapshot> {
  const includeInsights = options?.includeInsights ?? true
  const base = await fetchBaseHomepageData()
  const featuredCarousel = await buildFeaturedCarousel(base)

  return {
    featuredCarousel,
    latestTwins: base.latestTwins,
    newTwins: base.newTwins,
    insights: includeInsights ? await buildCopilotInsights(base) : [],
    watchlist: base.watchlist,
    activity: base.activity,
    error: base.error,
  }
}

function scoreSearchMatch(twin: TwinSummary, query: string): number {
  const q = query.toLowerCase()
  const id = twin.id.toLowerCase()
  const name = twin.displayName.toLowerCase()

  if (id === q || name === q) return 100
  if (id.startsWith(q) || name.startsWith(q)) return 70
  if (id.includes(q)) return 55
  if (name.includes(q)) return 45
  return 0
}

export async function searchTwins(query: string, limit = 8): Promise<TwinSummary[]> {
  const normalized = query.trim().toLowerCase()
  if (!normalized) {
    return []
  }

  if (isDatabaseConfigured()) {
    try {
      const catalogMatches = await searchCatalogTwins(query, limit)
      if (catalogMatches.length > 0) {
        return await Promise.all(catalogMatches.map((twin) => enrichTwinMetadata(twin)))
      }
    } catch (error) {
      console.error("[search] catalog search failed:", error)
    }
  }

  const base = await fetchBaseHomepageData()
  return dedupeTwins([...base.latestTwins, ...base.trendingTwins, ...base.newTwins])
    .map((twin) => ({
      twin,
      score: scoreSearchMatch(twin, normalized),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      return scorePerformance(right.twin) - scorePerformance(left.twin)
    })
    .slice(0, limit)
    .map((entry) => entry.twin)
}
