import "server-only"

import { listWatchlistTwinIds } from "@/lib/server/watchlist-store"
import { getTwinDetail, getTwinDetailSnapshot } from "@/lib/services/market/detail"
import type {
  TwinChartPoint,
  TwinSummary,
  WatchlistDashboardItem,
  WatchlistDashboardSnapshot,
} from "@/lib/types"

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

function resolveWatchlistCurrentPriceUsd(chart: TwinChartPoint[], twin: TwinSummary) {
  const latestClose = chart[chart.length - 1]?.closeUsd
  if (typeof latestClose === "number" && Number.isFinite(latestClose) && latestClose > 0) {
    return Number(latestClose.toFixed(4))
  }

  return Number(twin.lastPriceUsd.toFixed(4))
}

function resolveReferenceHourPriceUsd(chart: TwinChartPoint[], fallbackPrice: number) {
  const previousClose = chart[chart.length - 2]?.closeUsd
  if (typeof previousClose === "number" && Number.isFinite(previousClose) && previousClose > 0) {
    return previousClose
  }

  return fallbackPrice > 0 ? fallbackPrice : 0
}

function resolveWatchlistChange(input: {
  chart: TwinChartPoint[]
  twin: TwinSummary
  quoteBuyUsd: number
  currentPriceUsd: number
}) {
  const referenceHourPriceUsd = resolveReferenceHourPriceUsd(input.chart, input.currentPriceUsd)
  const safeIndexed = Number(input.twin.change1hPct.toFixed(2))

  if (referenceHourPriceUsd > 0 && input.quoteBuyUsd > 0) {
    return {
      change1hPct: Number(
        (((input.quoteBuyUsd - referenceHourPriceUsd) / referenceHourPriceUsd) * 100).toFixed(2)
      ),
      change1hSource: "live" as const,
    }
  }

  return {
    change1hPct: safeIndexed,
    change1hSource: "indexed" as const,
  }
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

      const quoteBuyUsd = Number(snapshot.quote.buyQuoteUsd)
      const currentPriceUsd = resolveWatchlistCurrentPriceUsd(snapshot.chart, snapshot.twin)
      const change = resolveWatchlistChange({
        chart: snapshot.chart,
        twin: snapshot.twin,
        quoteBuyUsd,
        currentPriceUsd,
      })
      const indexed24hTrades = snapshot.chart.slice(-24).reduce((sum, point) => sum + point.trades, 0)
      const hasFull24hTradeWindow = snapshot.chart.length >= 24

      const item: WatchlistDashboardItem = {
        twin: snapshot.twin,
        quote: snapshot.quote,
        insight: snapshot.insight,
        currentPriceUsd,
        change1hPct: change.change1hPct,
        change1hSource: change.change1hSource,
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
