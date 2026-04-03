"use client"

import Link from "next/link"
import { startTransition, useEffect, useMemo, useState } from "react"
import { formatCompactUsd, formatUsd } from "@/lib/currency"
import { CopilotLaunchButton } from "@/components/copilot-launch-button"
import { buildImageProxyUrl } from "@/lib/image-proxy"
import { QuickBuyControl } from "@/components/quick-buy-control"
import { useQuickBuySettings } from "@/components/quick-buy-settings-provider"
import { UiIcon } from "@/components/ui-icon"
import { useWallet } from "@/components/wallet-provider"
import { useWatchlist } from "@/components/watchlist-provider"
import type { FeaturedTwin, HomepageSnapshot, TwinSummary } from "@/lib/types"
import styles from "./home-terminal.module.css"

type Props = {
  initialSnapshot: HomepageSnapshot
}

function shortenTwinId(id: string) {
  return id.length > 14 ? `${id.slice(0, 6)}...${id.slice(-4)}` : id
}

function formatTickerTime(timestamp: number | undefined, nowMs: number) {
  if (!timestamp) return "just now"
  const diffMinutes = Math.max(0, Math.floor((nowMs - timestamp * 1000) / 60000))
  if (diffMinutes < 1) return "just now"
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const hours = Math.floor(diffMinutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function getSourceLabel(item: FeaturedTwin) {
  switch (item.source) {
    case "admin":
    case "env":
      return "Admin Pick"
    case "performance":
      return "Performance Leader"
    default:
      return "Spotlight"
  }
}

function getFeaturedSubLabel(item: FeaturedTwin) {
  return item.source === "performance" ? "Performance Leader" : "Admin Pick"
}

function getInsightLabel(insight: NonNullable<HomepageSnapshot["insights"]>[number]) {
  return insight.label || (insight.tone === "bullish" ? "AI PICK" : insight.tone === "bearish" ? "AI RISK" : "AI WATCH")
}

function getSignalLabel(twin: TwinSummary) {
  if (twin.signal === "buy") return "Keys: Buy"
  if (twin.signal === "sell") return "Keys: Sell"
  return "Keys: Watch"
}

function getSignalTone(twin: TwinSummary) {
  if (twin.signal === "buy") return styles.twinPositive
  if (twin.signal === "sell") return styles.twinNegative
  return styles.twinNeutral
}

function formatMomentumChange(value?: number) {
  const amount = value ?? 0
  return `${amount >= 0 ? "+" : ""}${amount.toFixed(1)}% indexed 1H`
}

function formatVolumeSpike(value?: number) {
  const amount = value ?? 0
  if (amount > 0) return `Volume spike +${amount.toFixed(0)}%`
  if (amount < 0) return `Volume cool ${amount.toFixed(0)}%`
  return "Volume flat"
}

function formatActivityTier(twin: TwinSummary) {
  if (twin.signal !== "buy") {
    return "Sell-side flow"
  }

  if (!twin.activityTierLabel || typeof twin.activityTierUsdValue !== "number") {
    return "Buy wallet unclassified"
  }
  const compactUsd =
    twin.activityTierUsdValue >= 1_000_000
      ? `$${(twin.activityTierUsdValue / 1_000_000).toFixed(1)}m`
      : twin.activityTierUsdValue >= 1_000
        ? `$${(twin.activityTierUsdValue / 1_000).toFixed(1)}k`
        : `$${Math.round(twin.activityTierUsdValue)}`

  return `${twin.activityTierIcon ?? ""} ${twin.activityTierLabel} · ${compactUsd}`.trim()
}

function getMetricTone(value?: number) {
  if ((value ?? 0) > 0) return styles.metricPositive
  if ((value ?? 0) < 0) return styles.metricNegative
  return styles.metricNeutral
}

function getMarketCapLabel(twin: TwinSummary) {
  return `Mcap: ${formatCompactUsd(twin.supply * twin.lastPriceUsd)}`
}

function getFeedStatus(error?: string) {
  if (!error) {
    return {
      label: "Indexed market feed",
      toneClass: styles.livePillRealtime,
      dotClass: styles.liveDotRealtime,
    }
  }

  const normalized = error.toLowerCase()
  if (normalized.includes("cached")) {
    return {
      label: "Cached indexed feed",
      toneClass: styles.livePillCached,
      dotClass: styles.liveDotWarning,
    }
  }

  if (normalized.includes("rate-limit") || normalized.includes("rate limit") || normalized.includes("429")) {
    return {
      label: "Rate-limited indexed feed",
      toneClass: styles.livePillWarning,
      dotClass: styles.liveDotWarning,
    }
  }

  return {
    label: "Market unavailable",
      toneClass: styles.livePillUnavailable,
      dotClass: styles.liveDotUnavailable,
  }
}

export function HomeTerminal({ initialSnapshot }: Props) {
  const [snapshot, setSnapshot] = useState(initialSnapshot)
  const [activeSlide, setActiveSlide] = useState(0)
  const [featuredBuyLocked, setFeaturedBuyLocked] = useState(false)
  const [gridMode, setGridMode] = useState<"live" | "fresh" | "momentum" | "watchlist">("live")
  const [relativeNowMs, setRelativeNowMs] = useState<number | null>(null)
  const [featuredTwinOverrides, setFeaturedTwinOverrides] = useState<Record<string, TwinSummary>>({})
  const { account } = useWallet()
  const { quickBuyAmount } = useQuickBuySettings()
  const { items: watchlistItems, hydrated: watchlistHydrated } = useWatchlist()

  useEffect(() => {
    setRelativeNowMs(Date.now())
    const interval = setInterval(() => {
      setRelativeNowMs(Date.now())
    }, 60_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (snapshot.featuredCarousel.length <= 1 || featuredBuyLocked) return
    const interval = setInterval(() => {
      setActiveSlide((current) => (current + 1) % snapshot.featuredCarousel.length)
    }, 8000)
    return () => clearInterval(interval)
  }, [featuredBuyLocked, snapshot.featuredCarousel.length])

  useEffect(() => {
    const interval = setInterval(async () => {
      if (document.visibilityState === "hidden") {
        return
      }

      try {
        const response = await fetch("/api/home", { cache: "no-store" })
        const nextSnapshot = (await response.json()) as HomepageSnapshot
        startTransition(() => {
          setSnapshot((current) => ({
            ...nextSnapshot,
            insights: current.insights,
          }))
        })
      } catch {
        // keep current state on polling failure
      }
    }, 30000)

    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (activeSlide >= snapshot.featuredCarousel.length) {
      setActiveSlide(0)
    }
  }, [activeSlide, snapshot.featuredCarousel.length])

  const featuredBase = snapshot.featuredCarousel[activeSlide] ?? null
  const featured = featuredBase
    ? {
        ...featuredBase,
        twin: featuredTwinOverrides[featuredBase.twin.id] ?? featuredBase.twin,
        displayName:
          (featuredTwinOverrides[featuredBase.twin.id] ?? featuredBase.twin).displayName,
      }
    : null
  const liveTwins = useMemo(() => snapshot.latestTwins.slice(0, 15), [snapshot.latestTwins])
  const freshTwins = useMemo(() => snapshot.newTwins.slice(0, 15), [snapshot.newTwins])
  const momentumTwins = useMemo(
    () =>
      [...snapshot.latestTwins]
        .sort((left, right) => {
          const rightChange = right.momentumChangePct ?? right.change1hPct ?? 0
          const leftChange = left.momentumChangePct ?? left.change1hPct ?? 0

          if (rightChange !== leftChange) {
            return rightChange - leftChange
          }

          if (right.volume24hUsd !== left.volume24hUsd) {
            return right.volume24hUsd - left.volume24hUsd
          }

          return right.totalTrades - left.totalTrades
        })
        .slice(0, 15),
    [snapshot.latestTwins]
  )
  const watchlistTwins = useMemo(() => watchlistItems.slice(0, 15), [watchlistItems])
  const gridTwins =
    gridMode === "watchlist"
      ? watchlistTwins
      : gridMode === "fresh"
        ? freshTwins
        : gridMode === "momentum"
          ? momentumTwins
          : liveTwins
  const leadInsight = snapshot.insights[0] ?? null
  const feedStatus = getFeedStatus(snapshot.error)
  const hasHomepageMarketData =
    snapshot.latestTwins.length > 0 ||
    snapshot.newTwins.length > 0 ||
    snapshot.featuredCarousel.length > 0 ||
    snapshot.activity.length > 0

  useEffect(() => {
    if (!featuredBase) {
      return
    }

    const controller = new AbortController()

    const refreshFeatured = async () => {
      try {
        const twinResponse = await fetch(`/api/twins/${encodeURIComponent(featuredBase.twin.id)}`, {
          cache: "no-store",
          signal: controller.signal,
        })

        if (!controller.signal.aborted && twinResponse.ok) {
          const nextTwin = (await twinResponse.json()) as TwinSummary
          setFeaturedTwinOverrides((current) => ({
            ...current,
            [featuredBase.twin.id]: nextTwin,
          }))
        }
      } catch {
        // keep the most recent successful featured data on refresh failure
      }
    }

    void refreshFeatured()
    const interval = setInterval(() => {
      if (document.visibilityState === "hidden") {
        return
      }
      void refreshFeatured()
    }, 20_000)

    return () => {
      controller.abort()
      clearInterval(interval)
    }
  }, [featuredBase])

  function renderFeaturedCard(className?: string) {
    if (!featured) return null

    return (
      <section className={`${styles.featuredCard} ${className ?? ""}`}>
        {featured.twin.avatarUrl ? (
          <div className={styles.featuredImageWrap} aria-hidden="true">
            <img
              src={buildImageProxyUrl(featured.twin.avatarUrl)}
              alt=""
              className={styles.featuredImage}
            />
          </div>
        ) : null}
        <div className={styles.featuredGlow} />
        <div className={styles.featuredContent}>
          <div className={styles.featuredTop}>
            <span className={styles.featuredBadge}>{getSourceLabel(featured)}</span>
            <div className={styles.carouselControls}>
              <button
                type="button"
                className={styles.carouselButton}
                onClick={() => {
                  if (featuredBuyLocked) return
                  setActiveSlide((current) =>
                    current === 0 ? snapshot.featuredCarousel.length - 1 : current - 1
                  )
                }}
                disabled={featuredBuyLocked}
              >
                <UiIcon name="arrow-left" className={styles.carouselIcon} />
              </button>
              <button
                type="button"
                className={styles.carouselButton}
                onClick={() => {
                  if (featuredBuyLocked) return
                  setActiveSlide((current) => (current + 1) % snapshot.featuredCarousel.length)
                }}
                disabled={featuredBuyLocked}
              >
                <UiIcon name="arrow-right" className={styles.carouselIcon} />
              </button>
            </div>
          </div>

          <div className={styles.featuredHeader}>
            <h2 className={styles.featuredTitle}>{featured.displayName}</h2>
            <p className={styles.featuredId}>{featured.twin.id}</p>
          </div>

          <div className={styles.pricePanel}>
            <p>Current Price</p>
            <div className={styles.featuredPrice}>{formatUsd(featured.twin.lastPriceUsd)}</div>
            <div className={getSignalTone(featured.twin)}>{getFeaturedSubLabel(featured)}</div>
          </div>

          <div className={styles.featuredStats}>
            <div>
              <p>Market Cap</p>
              <strong>{formatCompactUsd(featured.twin.supply * featured.twin.lastPriceUsd)}</strong>
            </div>
            <div>
              <p>Indexed 1H change</p>
              <strong className={getMetricTone(featured.twin.change1hPct)}>
                {featured.twin.change1hPct >= 0 ? "+" : ""}
                {featured.twin.change1hPct.toFixed(1)}%
              </strong>
            </div>
            <div>
              <p>Supply</p>
              <strong>{featured.twin.supply.toLocaleString()}</strong>
            </div>
            <div>
              <p>Holders</p>
              <strong>{featured.twin.holders.toLocaleString()}</strong>
            </div>
          </div>

          <div className={styles.featuredActions}>
            <QuickBuyControl
              twinId={featured.twin.id}
              variant="featured"
              onExpandedChange={setFeaturedBuyLocked}
              browseDataWarning={snapshot.error}
            />
            <Link className={styles.secondaryAction} href={`/twin/${featured.twin.id}`}>
              Details
            </Link>
          </div>

          <div className={styles.carouselDots}>
            {snapshot.featuredCarousel.map((item, index) => (
              <button
                key={`${item.twin.id}-${index}`}
                type="button"
                className={`${styles.carouselDot} ${
                  index === activeSlide ? styles.carouselDotActive : ""
                }`}
                onClick={() => {
                  if (featuredBuyLocked) return
                  setActiveSlide(index)
                }}
                disabled={featuredBuyLocked}
                aria-label={`View carousel item ${index + 1}`}
              />
            ))}
          </div>
        </div>
      </section>
    )
  }

  function renderInsights(className?: string, mobile = false) {
    if (mobile && !leadInsight) return null

    return (
      <section className={`${styles.insightCard} ${className ?? ""}`}>
        <div className={styles.insightTitle}>
          <UiIcon name="spark" className={styles.insightIcon} />
          <h3>{mobile ? "Copilot" : "AI Insights"}</h3>
        </div>

        <div className={styles.insightList}>
          {(mobile ? [leadInsight] : snapshot.insights).filter(Boolean).map((insight) => (
            <div
              key={insight!.id}
              className={`${styles.insightItem} ${
                insight!.tone === "bullish"
                  ? styles.insightBullish
                  : insight!.tone === "bearish"
                    ? styles.insightBearish
                    : styles.insightNeutral
              } ${mobile ? styles.mobileInsightItem : ""}`}
            >
              <span className={styles.insightBadge}>{getInsightLabel(insight!)}</span>
              <strong>{insight!.subject || insight!.title}</strong>
              {insight!.signals?.length ? (
                <div className={styles.insightSignals}>
                  {(mobile ? insight!.signals.slice(0, 3) : insight!.signals).map((signal) => (
                    <span key={signal}>{signal}</span>
                  ))}
                </div>
              ) : null}
              <p>{insight!.action || insight!.body}</p>
            </div>
          ))}
        </div>

        <div className={styles.promptBlock}>
          <p>{mobile ? "Open Copilot" : "Ask Copilot"}</p>
          {mobile ? (
            <CopilotLaunchButton
              className={styles.promptButton}
              prompt="Summarize the latest homepage opportunities and highlight the strongest twins to watch right now."
            >
              View full AI breakdown
            </CopilotLaunchButton>
          ) : (
            <>
              <CopilotLaunchButton
                className={styles.promptButton}
                prompt="Identify breakout twins under $100"
              >
                "Identify breakout twins under $100"
              </CopilotLaunchButton>
              <CopilotLaunchButton
                className={styles.promptButton}
                prompt="Show twins with highest holder growth"
              >
                "Show twins with highest holder growth"
              </CopilotLaunchButton>
            </>
          )}
        </div>
      </section>
    )
  }

  return (
    <>
      <div className={styles.layout}>
        <div className={styles.mainColumn}>
          <header className={styles.hero}>
            <div>
              <h1 className={styles.heroTitle}>Dashboard</h1>
              <p className={styles.heroSubtitle}>
                High-performance digital twin keys terminal
              </p>
            </div>
            <div className={`${styles.livePill} ${feedStatus.toneClass}`}>
              <span className={`${styles.liveDot} ${feedStatus.dotClass}`} />
              {feedStatus.label}
            </div>
          </header>

          <div className={styles.mobileLeadStack}>
            {renderFeaturedCard(styles.mobileFeaturedCard)}
            {renderInsights(styles.mobileInsightCard, true)}
          </div>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <span>
                {gridMode === "momentum"
                  ? "Trending now"
                  : gridMode === "watchlist"
                    ? "Your watchlist"
                    : gridMode === "fresh"
                      ? "Fresh launches"
                      : "Live opportunities"}
              </span>
              <div className={styles.filterSwitcher}>
                <button
                  type="button"
                  className={`${styles.filterChip} ${gridMode === "live" ? styles.filterChipActive : ""}`}
                  onClick={() => setGridMode("live")}
                >
                  Live
                </button>
                <button
                  type="button"
                  className={`${styles.filterChip} ${gridMode === "fresh" ? styles.filterChipActive : ""}`}
                  onClick={() => setGridMode("fresh")}
                >
                  Fresh
                </button>
                <button
                  type="button"
                  className={`${styles.filterChip} ${gridMode === "momentum" ? styles.filterChipActive : ""}`}
                  onClick={() => setGridMode("momentum")}
                >
                  Trending
                </button>
                <button
                  type="button"
                  className={`${styles.filterChip} ${gridMode === "watchlist" ? styles.filterChipActive : ""}`}
                  onClick={() => setGridMode("watchlist")}
                >
                  Watchlist
                </button>
              </div>
            </div>
            {gridMode === "watchlist" && watchlistHydrated && watchlistTwins.length === 0 ? (
              <div className={styles.emptyGridState}>
                {account
                  ? "No saved twins yet. Add a twin to your watchlist from its detail page to pin it here."
                  : "Connect your wallet to load your persisted watchlist here."}
              </div>
            ) : gridTwins.length === 0 ? (
              <div className={styles.emptyGridState}>
                {snapshot.error
                  ? gridMode === "fresh"
                    ? "We could not load fresh launches right now. Check the market-data connection and refresh."
                    : "We could not load live twins right now. Check the server market-data configuration and refresh."
                  : gridMode === "fresh"
                    ? "No newly launched twins are available in this feed yet."
                    : "No twins are available in this feed yet."}
              </div>
            ) : (
            <div className={styles.twinGrid}>
              {gridTwins.map((twin) => (
                <article key={twin.id} className={styles.twinCard}>
                  <Link href={`/twin/${twin.id}`} className={styles.twinCardLink}>
                  <div className={styles.twinCardHeader}>
                    <div className={styles.twinIdentity}>
                      {twin.avatarUrl ? (
                        <img
                          src={buildImageProxyUrl(twin.avatarUrl)}
                          alt={twin.displayName}
                          className={styles.twinAvatar}
                        />
                      ) : (
                        <div className={styles.twinAvatarFallback}>
                          {twin.displayName.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className={styles.twinName}>{twin.displayName}</div>
                        <div className={styles.twinId}>ID: {shortenTwinId(twin.id)}</div>
                      </div>
                    </div>
                    <div className={styles.twinSignalBlock}>
                      {gridMode === "fresh" ? (
                        <div className={styles.twinTime}>{twin.ageLabel} old</div>
                      ) : (
                        <>
                          <div className={`${styles.activityIconWrap} ${getSignalTone(twin)}`}>
                            <UiIcon
                              name={twin.signal === "sell" ? "sell" : "buy"}
                              className={styles.activityIcon}
                            />
                          </div>
                          <div className={styles.twinTime}>
                            {relativeNowMs ? formatTickerTime(twin.lastTradeAt, relativeNowMs) : "recent"}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className={styles.twinMetaRow}>
                    <span>Supply: {twin.supply.toLocaleString()}</span>
                    <span>Holders: {twin.holders.toLocaleString()}</span>
                    <span>{getMarketCapLabel(twin)}</span>
                    {gridMode === "fresh" ? <span>Age: {twin.ageLabel} old</span> : <span className={getSignalTone(twin)}>{getSignalLabel(twin)}</span>}
                  </div>

                  {gridMode === "momentum" ? (
                    <div className={styles.momentumMetrics}>
                      <span className={`${styles.metricBadge} ${getMetricTone(twin.momentumChangePct)}`}>
                        {formatMomentumChange(twin.momentumChangePct)}
                      </span>
                      <span className={`${styles.metricBadge} ${getMetricTone(twin.volumeSpikePct)}`}>
                        {formatVolumeSpike(twin.volumeSpikePct)}
                      </span>
                      <span
                        className={`${styles.metricBadge} ${
                          twin.signal === "buy" && twin.activityTier
                            ? styles.metricWhale
                            : styles.metricNeutral
                        }`}
                      >
                        {formatActivityTier(twin)}
                      </span>
                    </div>
                  ) : null}

                  </Link>
                  <div className={styles.twinCardFooter}>
                    <div className={styles.quickBuyHint}>
                      {quickBuyAmount
                        ? `Quick buy: ${quickBuyAmount} key${quickBuyAmount === 1 ? "" : "s"}`
                        : "Quick buy amount not set"}
                    </div>
                    <QuickBuyControl
                      twinId={twin.id}
                      variant="card"
                      buttonLabel="Quick Buy"
                      browseDataWarning={snapshot.error}
                    />
                  </div>
                </article>
              ))}
            </div>
            )}
          </section>
        </div>

        <aside className={styles.sideColumn}>
          {renderFeaturedCard()}
          {renderInsights()}

        </aside>
      </div>

      <div className={styles.activityDock}>
        <div className={styles.activityLabel}>
          <span className={styles.activityPulse} />
          Live activity
        </div>
        <div className={styles.activityTrack}>
          {[...snapshot.activity, ...snapshot.activity].map((item, index) => (
            <div key={`${item.id}-${index}`} className={styles.activityItem}>
              <span className={item.isBuy ? styles.twinPositive : styles.twinNegative}>
                [{item.isBuy ? "BUY" : "SELL"}]
              </span>
              <span>
                {item.trader} {item.isBuy ? "bought" : "sold"} {item.shareAmount} key
                {item.shareAmount === 1 ? "" : "s"} of @{item.twinDisplayName} for{" "}
                {formatCompactUsd(item.usdAmount)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
