export type FeaturedSource = "admin" | "env" | "auto" | "performance"

export type TwinSignal = "buy" | "sell" | "watch"
export type WalletActivityTier = "shrimp" | "crab" | "dolphin" | "whale" | "shark"

export type TwinSummary = {
  id: string
  displayName: string
  owner: string
  metadataUrl?: string
  avatarUrl?: string
  description?: string
  supply: number
  holders: number
  totalTrades: number
  totalVolumeEth: number
  totalVolumeUsd: number
  volume24hEth: number
  volume24hUsd: number
  volume1hEth: number
  volume1hUsd: number
  lastPriceEth: number
  lastPriceUsd: number
  change1hPct: number
  ageLabel: string
  lastTradeAt?: number
  lastTrader?: string
  signal?: TwinSignal
  momentumChangePct?: number
  volumeSpikePct?: number
  activityTier?: WalletActivityTier
  activityTierLabel?: string
  activityTierIcon?: string
  activityTierUsdValue?: number
  activityTierTrader?: string
}

export type TwinMetadata = {
  twinId: string
  url: string
  fetchedAt: string
  payloadHash: string
  name?: string
  description?: string
  imageUrl?: string
  links?: Record<string, string>
  starterQuestions?: string[]
  rawPayload: unknown
}

export type TwinQuote = {
  twinId: string
  amount: string
  buyQuoteWei: string
  sellQuoteWei: string
  buyQuoteEth: string
  sellQuoteEth: string
  buyQuoteUsd: string
  sellQuoteUsd: string
  feeSharePct: string
  holderBalance?: string
  holderBalanceWei?: string
  quotedAt?: string
  expiresAt?: string
  displayValuesAreIndicative?: boolean
}

export type CopilotQuotaSnapshot = {
  enabled: boolean
  scope: "wallet" | "guest"
  used: number
  limit: number | null
  remaining: number | null
  exhausted: boolean
  resetAt: string
}

export type TwinChartPoint = {
  time: number
  openUsd: number
  highUsd: number
  lowUsd: number
  closeUsd: number
  volumeUsd: number
  volumeBnb: number
  trades: number
  activeHolders: number
}

export type TwinDetailTrade = {
  id: string
  txHash: string
  trader: string
  isBuy: boolean
  shareAmount: number
  bnbAmount: number
  usdAmount: number
  pricePerShareUsd: number
  timestamp: number
  blockNumber: number
}

export type TwinDetailHolder = {
  id: string
  holder: string
  balance: number
  sharePct: number
  tradeCount: number
  isActive: boolean
  firstSeenAt?: number
  lastTradeAt?: number
}

export type TwinDetailInsightStat = {
  label: string
  value: string
  tone?: "bullish" | "bearish" | "neutral"
}

export type TwinDetailInsight = {
  label: string
  tone: "bullish" | "bearish" | "neutral"
  headline: string
  summary: string
  action: string
  signals: string[]
  stats: TwinDetailInsightStat[]
}

export type TwinDetailSnapshot = {
  twin: TwinSummary
  quote: TwinQuote
  chart: TwinChartPoint[]
  trades: TwinDetailTrade[]
  holders: TwinDetailHolder[]
  insight: TwinDetailInsight
  newLaunches: TwinSummary[]
  error?: string
}

export type TwinCreationQuote = {
  twinId: string
  exists: boolean
  owner: string
  isClaimed: boolean
  minSharesToCreate: string
  requiredValueWei: string
  requiredValueBnb: string
  requiredValueUsd: string
  quotedAt?: string
  expiresAt?: string
  displayValuesAreIndicative?: boolean
}

export type FeaturedTwin = {
  twin: TwinSummary
  quote: TwinQuote | null
  source: FeaturedSource
  sourceLabel: string
  displayName: string
}

export type HomepageSnapshot = {
  featuredCarousel: FeaturedTwin[]
  latestTwins: TwinSummary[]
  newTwins: TwinSummary[]
  insights: CopilotInsight[]
  watchlist: TwinSummary[]
  activity: ActivityItem[]
  error?: string
}

export type AppMeta = {
  totalTwins: number
}

export type WatchlistDashboardItem = {
  twin: TwinSummary
  quote: TwinQuote
  insight: TwinDetailInsight
  trend: number[]
  currentPriceUsd: number
  change1hPct: number
  change1hSource: "live" | "indexed"
  volume1hUsd: number
  trades24h: number
  tradeCountValue: number
  tradeCountLabel: string
  error?: string
}

export type WatchlistDashboardSnapshot = {
  items: WatchlistDashboardItem[]
  error?: string
}

export type PortfolioPosition = {
  twin: TwinSummary
  heldKeys: number
  positionValueUsd: number
  positionValueBnb: number
  buyOneKeyUsd: number
  buyOneKeyBnb: number
  exitQuoteUsd: number
  exitQuoteBnb: number
  shareOfPortfolioPct: number
  watched: boolean
}

export type PortfolioInsight = {
  id: string
  label: string
  headline: string
  summary: string
  tone: "bullish" | "bearish" | "neutral"
  twinId?: string
}

export type PortfolioConcentrationSlice = {
  twinId: string
  label: string
  sharePct: number
  valueUsd: number
}

export type PortfolioSnapshot = {
  account: string
  positions: PortfolioPosition[]
  portfolioValueUsd: number
  portfolioValueBnb: number
  totalPositions: number
  availableBnb: number
  availableUsd: number
  watchlistOverlapCount: number
  concentrationTopSharePct: number
  concentration: PortfolioConcentrationSlice[]
  insights: PortfolioInsight[]
  error?: string
}

export type AiHealthSnapshot = {
  status: "ready" | "degraded" | "unavailable"
  label: string
  detail: string
}

export type AiCopilotMode = "summary" | "compare" | "breakout" | "risk"

export type CopilotIntent =
  | "compare_twins"
  | "screen_twins"
  | "explain_twin"
  | "execution_assist"
  | "unknown"

export type CopilotResponseMode =
  | "comparison"
  | "screening"
  | "explanation"
  | "execution_assist"
  | "clarification"

export type CopilotClarificationReason =
  | "ambiguous_entities"
  | "missing_entities"
  | "low_confidence"

export type CopilotPlan = {
  intent: CopilotIntent
  responseMode: CopilotResponseMode
  entities: string[]
  confidence: number
  needsClarification: boolean
  clarificationReason?: CopilotClarificationReason
  rationale?: string
}

export type CopilotEntityCandidate = {
  id: string
  name: string
  confidence: number
}

export type ResolvedTwinEntity = {
  query: string
  id: string
  name: string
  confidence: number
  source: "memory" | "catalog" | "search" | "explicit"
  ambiguous?: boolean
  candidates?: CopilotEntityCandidate[]
}

export type CopilotMemoryTwin = {
  id: string
  name: string
}

export type CopilotMemory = {
  activeTwins: CopilotMemoryTwin[]
}

export type CopilotToolWarning = {
  tool: string
  message: string
}

export type CopilotCompactTwin = {
  id: string
  name: string
  owner: string
  supply: number
  marketCapUsd: number
  holders: number
  totalTrades: number
  volume24hUsd: number
  volume1hUsd: number
  priceUsd: number
  change1hPct: number
  volumeChange1hPct: number
  ageLabel: string
  buyQuoteUsd?: string
  sellQuoteUsd?: string
  holderConcentrationPct?: number
  recentBuyTradePct?: number
  activityTierLabel?: string
}

export type CopilotMomentumSnapshot = {
  twinId: string
  label: "cooling" | "steady" | "accelerating"
  score: number
  reasons: string[]
}

export type CopilotRiskFlag = {
  twinId: string
  level: "low" | "medium" | "high"
  label: string
  detail: string
}

export type CopilotCompareSnapshot = {
  twins: CopilotCompactTwin[]
  momentum: CopilotMomentumSnapshot[]
  riskFlags: CopilotRiskFlag[]
  metricWinners: Array<{
    metric: "price" | "holders" | "volume" | "change1h"
    twinId: string
    summary: string
  }>
  overallSummary: string
}

export type CopilotPreparedAction = {
  kind: "buy" | "sell" | "watchlist"
  label: string
  href: string
  twinId: string
}

export type AlertConditionType =
  | "price_above"
  | "price_below"
  | "volume_spike_pct"
  | "holder_growth_pct"

export type AlertStatus = "active" | "paused" | "triggered" | "archived"

export type UserAlert = {
  id: number
  account: string
  twinId: string
  label: string
  conditionType: AlertConditionType
  threshold: number
  windowMinutes: number | null
  status: AlertStatus
  note?: string
  lastTriggeredAt?: string
  createdAt: string
  updatedAt: string
}

export type CreateUserAlertInput = {
  account: string
  twinId: string
  label?: string
  conditionType: AlertConditionType
  threshold: number
  windowMinutes?: number | null
  note?: string
}

export type UpdateUserAlertInput = {
  label?: string
  threshold?: number
  windowMinutes?: number | null
  status?: AlertStatus
  note?: string
}

export type CopilotPromptReviewReason =
  | "clarification_required"
  | "orchestration_error"

export type CopilotPromptReviewStatus = "open" | "reviewed" | "ignored"

export type CopilotPromptReview = {
  id: number
  prompt: string
  account?: string
  reason: CopilotPromptReviewReason
  status: CopilotPromptReviewStatus
  responseMode?: CopilotResponseMode
  intent?: CopilotIntent
  confidence?: number
  history?: Array<{ prompt: string; response: string }>
  memory?: CopilotMemory
  requestedTwins?: Array<{ id: string; name: string }>
  resolvedEntities?: ResolvedTwinEntity[]
  warnings?: CopilotToolWarning[]
  errorMessage?: string
  createdAt: string
  reviewedAt?: string
}

export type AiCopilotTwinCard = {
  twin: TwinSummary
  holderDelta1h: number
  holderGrowth1hPct: number
  priceVelocity: "Low" | "Moderate" | "High"
  strengthPct: number
  evidence: string[]
}

export type AiCopilotSnapshot = {
  totalTwins: number
  feedError?: string
  aiHealth: AiHealthSnapshot
  verifiedNewHolders1h: number
  monitoredTwinCount: number
  openingLead: string
  spotlightTwins: AiCopilotTwinCard[]
  contextTwins: TwinSummary[]
  insights: CopilotInsight[]
  suggestedPrompts: string[]
}

export type ActivityItem = {
  id: string
  twinId: string
  twinDisplayName: string
  trader: string
  isBuy: boolean
  shareAmount: number
  ethAmount: number
  usdAmount: number
  timestamp: number
}

export type CopilotInsight = {
  id: string
  title: string
  body: string
  tone?: "bullish" | "bearish" | "neutral"
  label?: string
  subject?: string
  signals?: string[]
  action?: string
}

export type FeaturedOverride = {
  twinId: string
  label: string
  updatedAt: string
}

export type CopilotResult = {
  provider: string
  content: string
  modelName?: string
  settlementMode?: string
  transactionHash?: string | null
  paymentHash?: string | null
  teeId?: string | null
  teeEndpoint?: string | null
  teePaymentAddress?: string | null
  teeSignature?: string | null
  teeTimestamp?: number | null
  finishReason?: string | null
  responseMode?: CopilotResponseMode
  usedTwins?: TwinSummary[]
  resolvedEntities?: ResolvedTwinEntity[]
  memory?: CopilotMemory
  plan?: CopilotPlan
  warnings?: CopilotToolWarning[]
  availableActions?: CopilotPreparedAction[]
}
