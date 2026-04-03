import { getOpenGradientPrivateKey, getSubgraphUrl } from "@/lib/env"
import type {
  AiCopilotSnapshot,
  AiHealthSnapshot,
  CopilotInsight,
  TwinSummary,
} from "@/lib/types"
import type { HomepageSnapshot } from "@/lib/types"

export function dedupeTwins(items: TwinSummary[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

export function appendSnapshotError(currentError: string | undefined, nextError: string) {
  if (!currentError) return nextError
  if (currentError.includes(nextError)) return currentError
  return `${currentError} ${nextError}`.trim()
}

function buildInsight(id: string, twin: TwinSummary, tone: CopilotInsight["tone"], body: string): CopilotInsight {
  return {
    id,
    title: twin.displayName,
    label: tone === "bullish" ? "Momentum" : tone === "bearish" ? "Risk" : "Watch",
    subject: twin.displayName,
    tone,
    body,
    signals: [
      `${twin.change1hPct >= 0 ? "+" : ""}${twin.change1hPct.toFixed(1)}% 1h`,
      `$${Math.round(twin.volume24hUsd).toLocaleString()} 24h volume`,
      `${twin.holders.toLocaleString()} holders`,
    ],
    action:
      tone === "bullish"
        ? `Monitor ${twin.displayName} for follow-through if buy-side flow stays intact.`
        : tone === "bearish"
          ? `Treat ${twin.displayName} as higher-risk until flow stabilizes.`
          : `Keep ${twin.displayName} on watch for the next volume expansion.`,
  }
}

function getPriceVelocityLabel(change1hPct: number): "Low" | "Moderate" | "High" {
  if (Math.abs(change1hPct) >= 8) return "High"
  if (Math.abs(change1hPct) >= 3) return "Moderate"
  return "Low"
}

export function buildCopilotInsightsFromHomepage(snapshot: HomepageSnapshot): CopilotInsight[] {
  const twins = dedupeTwins([
    ...snapshot.featuredCarousel.map((item) => item.twin),
    ...snapshot.latestTwins,
    ...snapshot.newTwins,
    ...snapshot.watchlist,
  ]).slice(0, 3)

  return twins.map((twin, index) => {
    const tone: CopilotInsight["tone"] =
      twin.change1hPct >= 5 ? "bullish" : twin.change1hPct <= -5 ? "bearish" : "neutral"

    return buildInsight(
      `runtime-${index + 1}`,
      twin,
      tone,
      `${twin.displayName} is printing ${twin.change1hPct >= 0 ? "positive" : "negative"} short-term momentum with ${Math.round(
        twin.volume24hUsd
      ).toLocaleString()} USD in tracked 24h volume.`
    )
  })
}

export function buildAiHealthFromHomepage(snapshot: HomepageSnapshot): AiHealthSnapshot {
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
      detail: "OpenGradient is configured, but live subgraph access is not configured.",
    }
  }

  if (snapshot.error) {
    return {
      status: "degraded",
      label: "AI ready, market feed delayed",
      detail: "AI is configured, but market state is currently serving from delayed cached data.",
    }
  }

  return {
    status: "ready",
    label: "AI ready",
    detail: "AI and indexed market context are both available.",
  }
}

export function buildAiCopilotSnapshotFromHomepage(input: {
  snapshot: HomepageSnapshot
  totalTwins: number
  includeInsights: boolean
}): AiCopilotSnapshot {
  const contextTwins = dedupeTwins([
    ...input.snapshot.latestTwins,
    ...input.snapshot.newTwins,
    ...input.snapshot.watchlist,
    ...input.snapshot.featuredCarousel.map((item) => item.twin),
  ]).slice(0, 8)

  const spotlightTwins = contextTwins
    .slice()
    .sort((left, right) => {
      return (
        right.volume24hUsd - left.volume24hUsd ||
        right.change1hPct - left.change1hPct ||
        right.holders - left.holders
      )
    })
    .slice(0, 2)
    .map((twin) => ({
      twin,
      holderDelta1h: 0,
      holderGrowth1hPct: 0,
      priceVelocity: getPriceVelocityLabel(twin.change1hPct),
      strengthPct: Math.max(12, Math.min(100, Math.round(Math.abs(twin.change1hPct) * 4 + twin.holders * 0.2))),
      evidence: [
        `${twin.change1hPct >= 0 ? "+" : ""}${twin.change1hPct.toFixed(1)}% indexed 1h move`,
        `$${Math.round(twin.volume24hUsd).toLocaleString()} 24h volume`,
        `${twin.holders.toLocaleString()} holders`,
      ],
    }))

  const primary = spotlightTwins[0]?.twin
  const secondary = spotlightTwins[1]?.twin
  const openingLead = primary
    ? secondary
      ? `${primary.displayName} and ${secondary.displayName} are leading the current indexed market set by volume and short-term price movement.`
      : `${primary.displayName} is leading the current indexed market set by tracked volume and short-term price movement.`
    : "Indexed market snapshots are ready. Ask for a twin summary, comparison, or risk scan."

  return {
    totalTwins: input.totalTwins,
    aiHealth: buildAiHealthFromHomepage(input.snapshot),
    verifiedNewHolders1h: 0,
    monitoredTwinCount: contextTwins.length,
    openingLead,
    spotlightTwins,
    contextTwins,
    insights: input.includeInsights
      ? input.snapshot.insights.length > 0
        ? input.snapshot.insights
        : buildCopilotInsightsFromHomepage(input.snapshot)
      : [],
    suggestedPrompts: [
      primary
        ? `Analyze ${primary.displayName} using current holders, volume, and 1h price change.`
        : "Analyze the top active twin using current holders, volume, and 1h price change.",
      primary && secondary
        ? `Compare ${primary.displayName} versus ${secondary.displayName} using the indexed market snapshot.`
        : "Compare the top two active twins using the indexed market snapshot.",
      "Scan the indexed market state for strongest momentum and biggest downside risk.",
      "Explain which current twins look strongest based on tracked volume and holder counts.",
    ],
    ...(input.snapshot.error ? { feedError: input.snapshot.error } : {}),
  }
}
