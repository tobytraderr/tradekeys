import "server-only"

import { getMarketDataRuntimeSource, isLegacyMarketDataFallbackEnabled } from "@/lib/env"
import {
  getStoredHomepageRuntimeSnapshot,
  setStoredHomepageRuntimeSnapshot,
} from "@/lib/server/market-runtime-store"
import {
  HOMEPAGE_RUNTIME_SNAPSHOT_KEY,
  HOMEPAGE_RUNTIME_TTL_MS,
  isRuntimeSnapshotFresh,
  withHomepageRefreshLock,
} from "@/lib/services/market/caching"
import {
  MARKET_HOMEPAGE_SNAPSHOT_VERSION,
  type MarketHomepageSnapshotRecord,
  type MarketHomepageRuntimeState,
} from "@/lib/services/market/contracts"
import { recordCacheEvent, withOpsTrace } from "@/lib/server/ops-observability"
import * as legacy from "@/lib/services/market/legacy"
import type {
  ActivityItem,
  AppMeta,
  FeaturedTwin,
  HomepageSnapshot,
  TwinSummary,
} from "@/lib/types"

function toHomepageSnapshot(state: MarketHomepageRuntimeState): HomepageSnapshot {
  return {
    featuredCarousel: state.featuredCarousel,
    latestTwins: state.latestTwins,
    newTwins: state.newTwins,
    insights: state.insights,
    watchlist: state.watchlist,
    activity: state.activity,
    ...(state.error ? { error: state.error } : {}),
  }
}

function buildHomepageRecord(state: MarketHomepageRuntimeState): MarketHomepageSnapshotRecord {
  return {
    version: MARKET_HOMEPAGE_SNAPSHOT_VERSION,
    snapshotKey: HOMEPAGE_RUNTIME_SNAPSHOT_KEY,
    generatedAt: new Date().toISOString(),
    runtimeSource: "ingestion",
    snapshot: state,
  }
}

async function refreshHomepageRuntimeSnapshot(): Promise<MarketHomepageRuntimeState> {
  return withHomepageRefreshLock(async () => {
    return withOpsTrace({
      name: "homepage_build",
      dependency: "app",
      task: async () => {
        const [snapshot, trendingTwins, appMeta] = await Promise.all([
          legacy.getHomepageSnapshot(),
          legacy.getTrendingTwins(),
          legacy.getAppMeta(),
        ])
        const runtimeState: MarketHomepageRuntimeState = {
          ...snapshot,
          totalTwins: appMeta.totalTwins,
          trendingTwins,
        }
        await setStoredHomepageRuntimeSnapshot(
          HOMEPAGE_RUNTIME_SNAPSHOT_KEY,
          buildHomepageRecord(runtimeState)
        )
        recordCacheEvent({
          cache: "homepage",
          outcome: "refresh_success",
        })
        return runtimeState
      },
    })
  })
}

function stripInsights(snapshot: HomepageSnapshot): HomepageSnapshot {
  return {
    ...snapshot,
    insights: [],
  }
}

async function readHomepageRuntimeSnapshot(): Promise<HomepageSnapshot | null> {
  const stored = await getStoredHomepageRuntimeSnapshot(HOMEPAGE_RUNTIME_SNAPSHOT_KEY)
  if (!stored) return null
  return toHomepageSnapshot(stored.snapshot)
}

export async function getHomepageSnapshot(options?: {
  includeInsights?: boolean
}): Promise<HomepageSnapshot> {
  const includeInsights = options?.includeInsights ?? true
  if (getMarketDataRuntimeSource() !== "ingestion") {
    return legacy.getHomepageSnapshot(options)
  }

  const stored = await getStoredHomepageRuntimeSnapshot(HOMEPAGE_RUNTIME_SNAPSHOT_KEY)
  if (stored && isRuntimeSnapshotFresh(stored.generatedAt, HOMEPAGE_RUNTIME_TTL_MS)) {
    recordCacheEvent({
      cache: "homepage",
      outcome: "hit",
      ageMs: Date.now() - Date.parse(stored.generatedAt),
    })
    const snapshot = toHomepageSnapshot(stored.snapshot)
    return includeInsights ? snapshot : stripInsights(snapshot)
  }

  recordCacheEvent({
    cache: "homepage",
    outcome: "miss",
    ageMs: stored?.generatedAt ? Date.now() - Date.parse(stored.generatedAt) : undefined,
  })

  try {
    const refreshed = await refreshHomepageRuntimeSnapshot()
    const snapshot = toHomepageSnapshot(refreshed)
    return includeInsights ? snapshot : stripInsights(snapshot)
  } catch (error) {
    recordCacheEvent({
      cache: "homepage",
      outcome: "refresh_failure",
      error,
    })
    if (stored?.snapshot) {
      recordCacheEvent({
        cache: "homepage",
        outcome: "stale_served",
        ageMs: stored.generatedAt ? Date.now() - Date.parse(stored.generatedAt) : undefined,
        error,
      })
      const snapshot = toHomepageSnapshot(stored.snapshot)
      return includeInsights ? snapshot : stripInsights(snapshot)
    }

    if (isLegacyMarketDataFallbackEnabled()) {
      const fallback = await legacy.getHomepageSnapshot(options)
      const runtimeState: MarketHomepageRuntimeState = {
        ...fallback,
        totalTwins: await legacy.getAppMeta().then((value) => value.totalTwins).catch(() => 0),
        trendingTwins: await legacy.getTrendingTwins().catch(() => []),
      }
      await setStoredHomepageRuntimeSnapshot(
        HOMEPAGE_RUNTIME_SNAPSHOT_KEY,
        buildHomepageRecord(runtimeState)
      )
      return fallback
    }

    return {
      featuredCarousel: [],
      latestTwins: [],
      newTwins: [],
      insights: [],
      watchlist: [],
      activity: [],
      error: error instanceof Error ? error.message : "Market homepage snapshot unavailable.",
    }
  }
}

export async function getAppMeta(): Promise<AppMeta> {
  if (getMarketDataRuntimeSource() !== "ingestion") {
    return legacy.getAppMeta()
  }

  const stored = await getStoredHomepageRuntimeSnapshot(HOMEPAGE_RUNTIME_SNAPSHOT_KEY)
  if (stored?.snapshot.totalTwins && stored.snapshot.totalTwins > 0) {
    return {
      totalTwins: stored.snapshot.totalTwins,
    }
  }

  try {
    const refreshed = await refreshHomepageRuntimeSnapshot()
    return {
      totalTwins: refreshed.totalTwins,
    }
  } catch {
    return legacy.getAppMeta()
  }
}

export async function getTrendingTwins(): Promise<TwinSummary[]> {
  if (getMarketDataRuntimeSource() !== "ingestion") {
    return legacy.getTrendingTwins()
  }

  const stored = await getStoredHomepageRuntimeSnapshot(HOMEPAGE_RUNTIME_SNAPSHOT_KEY)
  if (stored?.snapshot.trendingTwins?.length) {
    return stored.snapshot.trendingTwins
  }

  const snapshot = await getHomepageSnapshot({ includeInsights: false })
  return snapshot.featuredCarousel.map((item) => item.twin)
}

export async function getLatestActivityTwins(): Promise<TwinSummary[]> {
  const snapshot = await getHomepageSnapshot({ includeInsights: false })
  return snapshot.latestTwins
}

export async function getNewTwins(): Promise<TwinSummary[]> {
  const snapshot = await getHomepageSnapshot({ includeInsights: false })
  return snapshot.newTwins
}

export async function getWatchlistTwins(): Promise<TwinSummary[]> {
  const snapshot = await getHomepageSnapshot({ includeInsights: false })
  return snapshot.watchlist
}

export async function getHomepageActivity(): Promise<ActivityItem[]> {
  const snapshot = await getHomepageSnapshot({ includeInsights: false })
  return snapshot.activity
}

export async function getFeaturedTwin(): Promise<FeaturedTwin | null> {
  const snapshot = await getHomepageSnapshot({ includeInsights: false })
  return snapshot.featuredCarousel[0] ?? null
}
