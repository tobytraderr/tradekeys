import "server-only"

import { getMarketDataRuntimeSource, isLegacyMarketDataFallbackEnabled } from "@/lib/env"
import {
  getStoredTwinDetailRuntimeSnapshot,
  setStoredTwinDetailRuntimeSnapshot,
} from "@/lib/server/market-runtime-store"
import {
  TWIN_DETAIL_RUNTIME_TTL_MS,
  isRuntimeSnapshotFresh,
  withTwinDetailRefreshLock,
} from "@/lib/services/market/caching"
import {
  MARKET_TWIN_DETAIL_SNAPSHOT_VERSION,
  type MarketTwinDetailSnapshotRecord,
} from "@/lib/services/market/contracts"
import { appendSnapshotError } from "@/lib/services/market/formatting"
import { recordCacheEvent, withOpsTrace } from "@/lib/server/ops-observability"
import * as legacy from "@/lib/services/market/legacy"
import type { TwinDetailSnapshot, TwinSummary } from "@/lib/types"

function buildTwinDetailRecord(
  twinId: string,
  snapshot: TwinDetailSnapshot
): MarketTwinDetailSnapshotRecord {
  return {
    version: MARKET_TWIN_DETAIL_SNAPSHOT_VERSION,
    twinId,
    generatedAt: new Date().toISOString(),
    runtimeSource: "ingestion",
    snapshot,
  }
}

async function refreshTwinDetailRuntimeSnapshot(twinId: string) {
  return withTwinDetailRefreshLock(twinId, async () => {
    return withOpsTrace({
      name: "twin_detail_build",
      dependency: "app",
      data: { twinId },
      task: async () => {
        const snapshot = await legacy.getTwinDetailSnapshot(twinId)
        if (!snapshot) {
          return null
        }

        await setStoredTwinDetailRuntimeSnapshot(twinId, buildTwinDetailRecord(twinId, snapshot))
        recordCacheEvent({
          cache: "twin-detail",
          twinId,
          outcome: "refresh_success",
        })
        return snapshot
      },
    })
  })
}

function withStaleDetailError(snapshot: TwinDetailSnapshot, error: unknown): TwinDetailSnapshot {
  return {
    ...snapshot,
    error: appendSnapshotError(
      snapshot.error,
      error instanceof Error
        ? error.message
        : "Showing the most recent cached twin detail snapshot."
    ),
  }
}

export async function getTwinDetailResult(id: string): Promise<{
  twin: TwinSummary | null
  error?: string
  unavailable?: boolean
}> {
  const snapshot = await getTwinDetailSnapshot(id)
  if (!snapshot) {
    return { twin: null }
  }

  return {
    twin: snapshot.twin,
    ...(snapshot.error ? { error: snapshot.error } : {}),
  }
}

export async function getTwinDetail(id: string): Promise<TwinSummary | null> {
  const result = await getTwinDetailResult(id)
  return result.twin
}

export async function getTwinDetailSnapshot(id: string): Promise<TwinDetailSnapshot | null> {
  if (getMarketDataRuntimeSource() !== "ingestion") {
    return legacy.getTwinDetailSnapshot(id)
  }

  const stored = await getStoredTwinDetailRuntimeSnapshot(id)
  if (stored && isRuntimeSnapshotFresh(stored.generatedAt, TWIN_DETAIL_RUNTIME_TTL_MS)) {
    recordCacheEvent({
      cache: "twin-detail",
      twinId: id,
      outcome: "hit",
      ageMs: Date.now() - Date.parse(stored.generatedAt),
    })
    return stored.snapshot
  }

  recordCacheEvent({
    cache: "twin-detail",
    twinId: id,
    outcome: "miss",
    ageMs: stored?.generatedAt ? Date.now() - Date.parse(stored.generatedAt) : undefined,
  })

  try {
    const refreshed = await refreshTwinDetailRuntimeSnapshot(id)
    if (refreshed) {
      return refreshed
    }
  } catch (error) {
    recordCacheEvent({
      cache: "twin-detail",
      twinId: id,
      outcome: "refresh_failure",
      error,
    })
    if (stored?.snapshot) {
      recordCacheEvent({
        cache: "twin-detail",
        twinId: id,
        outcome: "stale_served",
        ageMs: stored.generatedAt ? Date.now() - Date.parse(stored.generatedAt) : undefined,
        error,
      })
      return withStaleDetailError(stored.snapshot, error)
    }
  }

  if (stored?.snapshot) {
    recordCacheEvent({
      cache: "twin-detail",
      twinId: id,
      outcome: "stale_served",
      ageMs: stored.generatedAt ? Date.now() - Date.parse(stored.generatedAt) : undefined,
    })
    return stored.snapshot
  }

  if (isLegacyMarketDataFallbackEnabled()) {
    const fallback = await legacy.getTwinDetailSnapshot(id)
    if (fallback) {
      await setStoredTwinDetailRuntimeSnapshot(id, buildTwinDetailRecord(id, fallback))
    }
    return fallback
  }

  return null
}
