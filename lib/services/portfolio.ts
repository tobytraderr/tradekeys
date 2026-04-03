import "server-only"

import { convertBnbToUsd } from "@/lib/currency"
import { fetchAddressNativeBalance, fetchBnbUsdPrice } from "@/lib/server/rpc"
import { fetchPortfolioTwinHolders } from "@/lib/server/subgraph"
import { listWatchlistTwinIds } from "@/lib/server/watchlist-store"
import { getTwinDetailResult } from "@/lib/services/market/detail"
import { getTwinQuote } from "@/lib/services/market/pricing"
import type {
  PortfolioConcentrationSlice,
  PortfolioInsight,
  PortfolioPosition,
  PortfolioSnapshot,
} from "@/lib/types"

type RawPortfolioTwinHolder = {
  id: string
  balance: string
  digitalTwin?: {
    id?: string
  } | null
}

function parseInteger(value: string | null | undefined) {
  if (!value) return 0
  try {
    return Number(BigInt(value))
  } catch {
    return 0
  }
}

function parseDecimal(value: string | null | undefined) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

function pickConcentrationSlices(positions: PortfolioPosition[]): PortfolioConcentrationSlice[] {
  const top = positions.slice(0, 3).map((position) => ({
    twinId: position.twin.id,
    label: position.twin.displayName,
    sharePct: position.shareOfPortfolioPct,
    valueUsd: position.positionValueUsd,
  }))

  if (positions.length <= 3) {
    return top
  }

  const otherPositions = positions.slice(3)
  const otherShare = otherPositions.reduce((sum, position) => sum + position.shareOfPortfolioPct, 0)
  const otherValue = otherPositions.reduce((sum, position) => sum + position.positionValueUsd, 0)

  return [
    ...top,
    {
      twinId: "other",
      label: `Other (${otherPositions.length})`,
      sharePct: otherShare,
      valueUsd: otherValue,
    },
  ]
}

function buildPortfolioInsights(
  positions: PortfolioPosition[],
  watchlistOverlapCount: number
): PortfolioInsight[] {
  if (positions.length === 0) {
    return []
  }

  const topPosition = positions[0]
  const strongestMomentum = [...positions].sort(
    (left, right) => right.twin.change1hPct - left.twin.change1hPct
  )[0]
  const thinnestExit = [...positions].sort(
    (left, right) => left.twin.volume24hUsd - right.twin.volume24hUsd
  )[0]

  const insights: PortfolioInsight[] = []

  insights.push(
    topPosition.shareOfPortfolioPct >= 55
      ? {
          id: "concentration-risk",
          label: "Copilot insight",
          headline: `High concentration in ${topPosition.twin.displayName}`,
          summary: `${topPosition.twin.displayName} accounts for ${topPosition.shareOfPortfolioPct.toFixed(
            0
          )}% of current portfolio value. Check exit depth before adding more exposure.`,
          tone: "bearish",
          twinId: topPosition.twin.id,
        }
      : {
          id: "concentration-balance",
          label: "Copilot insight",
          headline: "Exposure is spread across your held twins",
          summary: `${positions.length} open position${
            positions.length === 1 ? "" : "s"
          } are live, with ${topPosition.twin.displayName} currently leading at ${topPosition.shareOfPortfolioPct.toFixed(
            0
          )}% of portfolio value.`,
          tone: "neutral",
          twinId: topPosition.twin.id,
        }
  )

  if (strongestMomentum && strongestMomentum.twin.change1hPct > 0) {
    insights.push({
      id: "momentum-leader",
      label: "Momentum leader",
      headline: `${strongestMomentum.twin.displayName} is leading your 1H move`,
      summary: `${strongestMomentum.twin.displayName} is up ${strongestMomentum.twin.change1hPct.toFixed(
        1
      )}% over the last hour with ${strongestMomentum.twin.holders.toLocaleString()} holders and ${Math.round(
        strongestMomentum.twin.volume24hUsd
      ).toLocaleString()} USD in 24H volume.`,
      tone: "bullish",
      twinId: strongestMomentum.twin.id,
    })
  }

  if (watchlistOverlapCount > 0) {
    insights.push({
      id: "watchlist-overlap",
      label: "Tracked holdings",
      headline: `${watchlistOverlapCount} held twin${
        watchlistOverlapCount === 1 ? "" : "s"
      } are already on your watchlist`,
      summary:
        "Use the watchlist overlap panel to keep follow-up analysis pinned to the positions you already own.",
      tone: "neutral",
    })
  } else if (thinnestExit) {
    insights.push({
      id: "liquidity-check",
      label: "Exit depth",
      headline: `${thinnestExit.twin.displayName} has the thinnest recent flow`,
      summary: `${thinnestExit.twin.displayName} is your lowest-liquidity holding right now with ${Math.round(
        thinnestExit.twin.volume24hUsd
      ).toLocaleString()} USD in 24H volume.`,
      tone: "neutral",
      twinId: thinnestExit.twin.id,
    })
  }

  return insights.slice(0, 3)
}

export async function getPortfolioSnapshot(account: string): Promise<PortfolioSnapshot> {
  const [rawHolders, balance, usdPerBnb, watchlistIds] = await Promise.all([
    fetchPortfolioTwinHolders(account).catch(() => []),
    fetchAddressNativeBalance(account as `0x${string}`).catch(() => null),
    fetchBnbUsdPrice().catch(() => null),
    listWatchlistTwinIds(account).catch(() => []),
  ])

  const watchlistSet = new Set(watchlistIds)
  const holders = (rawHolders as RawPortfolioTwinHolder[]).filter(
    (entry) => Boolean(entry.digitalTwin?.id) && parseInteger(entry.balance) > 0
  )

  const results = await Promise.allSettled(
    holders.map(async (holder) => {
      const twinId = holder.digitalTwin!.id!
      const heldKeys = parseInteger(holder.balance)
      const [detailResult, buyOneQuote, exitQuote] = await Promise.all([
        getTwinDetailResult(twinId),
        getTwinQuote(twinId, 1n, account as `0x${string}`),
        getTwinQuote(twinId, BigInt(holder.balance), account as `0x${string}`),
      ])

      if (!detailResult.twin) {
        throw new Error(`Twin ${twinId} detail unavailable.`)
      }

      const positionValueUsd =
        parseDecimal(exitQuote?.sellQuoteUsd) || detailResult.twin.lastPriceUsd * heldKeys
      const positionValueBnb =
        parseDecimal(exitQuote?.sellQuoteEth) || detailResult.twin.lastPriceEth * heldKeys

      const position: PortfolioPosition = {
        twin: detailResult.twin,
        heldKeys,
        positionValueUsd,
        positionValueBnb,
        buyOneKeyUsd: parseDecimal(buyOneQuote?.buyQuoteUsd) || detailResult.twin.lastPriceUsd,
        buyOneKeyBnb: parseDecimal(buyOneQuote?.buyQuoteEth) || detailResult.twin.lastPriceEth,
        exitQuoteUsd: parseDecimal(exitQuote?.sellQuoteUsd),
        exitQuoteBnb: parseDecimal(exitQuote?.sellQuoteEth),
        shareOfPortfolioPct: 0,
        watched: watchlistSet.has(twinId),
      }

      return position
    })
  )

  const positions = results
    .flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
    .sort((left, right) => right.positionValueUsd - left.positionValueUsd)

  const portfolioValueUsd = positions.reduce((sum, position) => sum + position.positionValueUsd, 0)
  const portfolioValueBnb = positions.reduce((sum, position) => sum + position.positionValueBnb, 0)

  const normalizedPositions = positions.map((position) => ({
    ...position,
    shareOfPortfolioPct:
      portfolioValueUsd > 0 ? (position.positionValueUsd / portfolioValueUsd) * 100 : 0,
  }))

  const watchlistOverlapCount = normalizedPositions.filter((position) => position.watched).length
  const concentration = pickConcentrationSlices(normalizedPositions)
  const concentrationTopSharePct = normalizedPositions[0]?.shareOfPortfolioPct ?? 0
  const insights = buildPortfolioInsights(normalizedPositions, watchlistOverlapCount)

  const failureCount = results.filter((result) => result.status === "rejected").length
  const error =
    failureCount > 0
      ? `Some held twins could not be enriched live. Showing ${normalizedPositions.length} synced position${
          normalizedPositions.length === 1 ? "" : "s"
        }.`
      : undefined

  return {
    account,
    positions: normalizedPositions,
    portfolioValueUsd,
    portfolioValueBnb,
    totalPositions: normalizedPositions.length,
    availableBnb: balance?.bnb ?? 0,
    availableUsd:
      balance && typeof usdPerBnb === "number" ? convertBnbToUsd(balance.bnb, usdPerBnb) : 0,
    watchlistOverlapCount,
    concentrationTopSharePct,
    concentration,
    insights,
    ...(error ? { error } : {}),
  }
}
