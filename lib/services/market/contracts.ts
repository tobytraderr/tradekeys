import type { HomepageSnapshot, TwinDetailSnapshot, TwinSummary } from "@/lib/types"

export const MARKET_HOMEPAGE_SNAPSHOT_VERSION = 1
export const MARKET_TWIN_DETAIL_SNAPSHOT_VERSION = 1

export type MarketRuntimeSourceLabel = "legacy" | "ingestion"

export type MarketHomepageRuntimeState = HomepageSnapshot & {
  totalTwins: number
  trendingTwins: TwinSummary[]
}

export type MarketHomepageSnapshotRecord = {
  version: typeof MARKET_HOMEPAGE_SNAPSHOT_VERSION
  snapshotKey: string
  generatedAt: string
  runtimeSource: MarketRuntimeSourceLabel
  snapshot: MarketHomepageRuntimeState
}

export type MarketTwinDetailSnapshotRecord = {
  version: typeof MARKET_TWIN_DETAIL_SNAPSHOT_VERSION
  twinId: string
  generatedAt: string
  runtimeSource: MarketRuntimeSourceLabel
  snapshot: TwinDetailSnapshot
}
