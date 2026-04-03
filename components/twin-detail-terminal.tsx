"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { buildImageProxyUrl } from "@/lib/image-proxy"
import { CopilotLaunchButton } from "@/components/copilot-launch-button"
import { formatCompactUsd, formatUsd } from "@/lib/currency"
import { TradePanel } from "@/components/trade-panel"
import { TwinPriceChart } from "@/components/twin-price-chart"
import { UiIcon } from "@/components/ui-icon"
import { useWallet } from "@/components/wallet-provider"
import { useWatchlist } from "@/components/watchlist-provider"
import type { TwinDetailHolder, TwinDetailSnapshot, TwinDetailTrade, TwinSummary } from "@/lib/types"
import styles from "@/components/twin-detail-terminal.module.css"

function shortAddress(value: string) {
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value
}

function formatAgeLong(ageLabel: string) {
  const match = ageLabel.match(/^(\d+)([mhd])$/)
  if (!match) return ageLabel
  const [, value, unit] = match
  if (unit === "m") return `${value} minute${value === "1" ? "" : "s"}`
  if (unit === "h") return `${value} hour${value === "1" ? "" : "s"}`
  return `${value} day${value === "1" ? "" : "s"}`
}

function formatRelativeTime(timestamp: number | undefined, nowSeconds: number) {
  if (!timestamp) return "Just now"
  const diffSeconds = Math.max(0, nowSeconds - timestamp)
  if (diffSeconds < 60) return `${diffSeconds}s ago`
  const minutes = Math.floor(diffSeconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function marketCapUsd(twin: TwinSummary) {
  return twin.supply * twin.lastPriceUsd
}

function buildTwinBreakdownPrompt(twin: TwinSummary) {
  return `Give me a full data breakdown for ${twin.displayName} (${twin.id}). Focus on holder concentration, recent trade flow, indexed momentum, and execution risk.`
}

function HoldingsTable({ holders }: { holders: TwinDetailHolder[] }) {
  return (
    <section className={styles.dataCard}>
      <div className={styles.dataCardHead}>
        <h3>Top Holders</h3>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Address</th>
              <th>Balance</th>
              <th>%</th>
            </tr>
          </thead>
          <tbody>
            {holders.slice(0, 8).map((holder) => (
              <tr key={holder.id}>
                <td>{shortAddress(holder.holder)}</td>
                <td>{holder.balance.toLocaleString()} Keys</td>
                <td>{holder.sharePct.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function RecentTradesList({
  trades,
  relativeNowSeconds,
}: {
  trades: TwinDetailTrade[]
  relativeNowSeconds: number | null
}) {
  return (
    <section className={styles.dataCard}>
      <div className={styles.dataCardHead}>
        <h3>Recent Trades</h3>
      </div>
      <div className={styles.tradeList}>
        {trades.slice(0, 8).map((trade) => (
          <div key={trade.id} className={styles.tradeRow}>
            <div className={styles.tradeMeta}>
              <span
                className={`${styles.tradeIcon} ${trade.isBuy ? styles.tradeIconBuy : styles.tradeIconSell}`}
              >
                <UiIcon name={trade.isBuy ? "buy" : "sell"} />
              </span>
              <div>
                <strong>
                  {trade.isBuy ? "Buy" : "Sell"} {trade.shareAmount} Key
                  {trade.shareAmount === 1 ? "" : "s"}
                </strong>
                <p>
                  {shortAddress(trade.trader)} |{" "}
                  {relativeNowSeconds
                    ? formatRelativeTime(trade.timestamp, relativeNowSeconds)
                    : "recent"}
                </p>
              </div>
            </div>
            <div className={trade.isBuy ? styles.tradeValueBuy : styles.tradeValueSell}>
              {formatUsd(trade.usdAmount)}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function ShareButton({
  twin,
  onFeedback,
}: {
  twin: TwinSummary
  onFeedback: (message: string, tone: "success" | "error") => void
}) {
  const [open, setOpen] = useState(false)
  const shareSupported = typeof navigator !== "undefined" && typeof navigator.share === "function"

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      onFeedback("Twin link copied.", "success")
      setOpen(false)
    } catch {
      onFeedback("Could not copy the twin link.", "error")
    }
  }

  async function nativeShare() {
    if (!shareSupported) {
      onFeedback("Native share is not available on this device.", "error")
      return
    }

    try {
      await navigator.share({
        title: twin.displayName,
        text: `Track ${twin.displayName} on TradeKeys.`,
        url: window.location.href,
      })
      onFeedback("Share sheet opened.", "success")
      setOpen(false)
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return
      }
      onFeedback("Could not open the share sheet.", "error")
    }
  }

  return (
    <div className={styles.actionMenu}>
      <button
        type="button"
        className={styles.iconButton}
        aria-label="Share twin"
        onClick={() => setOpen((current) => !current)}
      >
        <UiIcon name="share" />
      </button>
      {open ? (
        <div className={styles.menu}>
          {shareSupported ? (
            <button type="button" className={styles.menuButton} onClick={() => void nativeShare()}>
              Share...
            </button>
          ) : null}
          <button type="button" className={styles.menuButton} onClick={() => void copyLink()}>
            Copy Link
          </button>
        </div>
      ) : null}
    </div>
  )
}

function WatchlistIconButton({
  twin,
  onFeedback,
}: {
  twin: TwinSummary
  onFeedback: (message: string, tone: "success" | "error") => void
}) {
  const { account, connect, connecting } = useWallet()
  const { isWatched, toggle, hydrated, loading, error } = useWatchlist()
  const watched = isWatched(twin.id)

  async function handleClick() {
    if (!account) {
      await connect()
      return
    }

    try {
      await toggle(twin)
      onFeedback(
        watched ? "Removed from watchlist." : "Added to watchlist.",
        "success"
      )
    } catch (cause) {
      onFeedback(
        cause instanceof Error ? cause.message : "Watchlist update failed.",
        "error"
      )
    }
  }

  return (
    <button
      type="button"
      className={`${styles.iconButton} ${watched ? styles.iconButtonActive : ""}`}
      aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
      onClick={() => void handleClick()}
      disabled={!hydrated || loading || connecting}
      title={error || undefined}
    >
      <UiIcon name="star" />
    </button>
  )
}

export function TwinDetailTerminal({ snapshot }: { snapshot: TwinDetailSnapshot }) {
  const { twin, quote, chart, holders, trades, insight, newLaunches } = snapshot
  const [mobileTab, setMobileTab] = useState<"trades" | "holders">("trades")
  const [heroExpanded, setHeroExpanded] = useState(false)
  const [relativeNowSeconds, setRelativeNowSeconds] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<{
    message: string
    tone: "success" | "error"
  } | null>(null)

  useEffect(() => {
    setRelativeNowSeconds(Math.floor(Date.now() / 1000))
    const interval = setInterval(() => {
      setRelativeNowSeconds(Math.floor(Date.now() / 1000))
    }, 30_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!feedback) {
      return
    }

    const timeout = window.setTimeout(() => {
      setFeedback(null)
    }, 2400)

    return () => window.clearTimeout(timeout)
  }, [feedback])

  const chartSummary = useMemo(() => {
    const latest = chart[chart.length - 1]
    return {
      price: latest?.closeUsd ?? twin.lastPriceUsd,
      marketCap: marketCapUsd(twin),
    }
  }, [chart, twin])

  function renderCopilotCard(className?: string) {
    return (
      <section className={`${styles.copilotCard} ${className ?? ""}`}>
        <div className={styles.copilotHead}>
          <span className={styles.copilotDot} />
          <span>Copilot Insight</span>
        </div>
        <h2>{insight.headline}</h2>
        <p className={styles.copilotSummary}>{insight.summary}</p>
        <div className={styles.signalList}>
          {insight.signals.map((signal) => (
            <span key={signal}>{signal}</span>
          ))}
        </div>
        <div className={styles.insightStats}>
          {insight.stats.map((stat) => (
            <div key={stat.label} className={styles.insightStatRow}>
              <span>{stat.label}</span>
              <strong
                className={
                  stat.tone === "bullish"
                    ? styles.statBullish
                    : stat.tone === "bearish"
                      ? styles.statBearish
                      : styles.statNeutral
                }
              >
                {stat.value}
              </strong>
            </div>
          ))}
        </div>
        <p className={styles.copilotAction}>{insight.action}</p>
        <CopilotLaunchButton
          className={styles.copilotButton}
          prompt={buildTwinBreakdownPrompt(twin)}
        >
          Full Data Breakdown
        </CopilotLaunchButton>
      </section>
    )
  }

  function renderAlertsCard(className?: string) {
    return (
      <section className={`${styles.alertCard} ${className ?? ""}`}>
        <div className={styles.alertHead}>
          <span>New Listing Alerts</span>
        </div>
        <div className={styles.alertList}>
          {newLaunches.map((launch) => (
            <Link key={launch.id} href={`/twin/${launch.id}`} className={styles.alertItem}>
              <div>
                <strong>{launch.displayName}</strong>
                <p>{launch.ageLabel} old</p>
              </div>
              <span>New launch</span>
            </Link>
          ))}
        </div>
      </section>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.mainColumn}>
        {snapshot.error ? (
          <section className={styles.statusBanner}>
            <strong>Market data delayed</strong>
            <p>{snapshot.error}</p>
          </section>
        ) : null}

        <section className={styles.heroCard}>
          <div className={styles.heroIdentity}>
            {twin.avatarUrl ? (
              <img
                src={buildImageProxyUrl(twin.avatarUrl)}
                alt={twin.displayName}
                className={styles.heroAvatar}
              />
            ) : (
              <div className={`${styles.heroAvatar} ${styles.heroAvatarFallback}`}>
                {twin.displayName.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className={styles.heroSummary}>
              <div className={styles.heroCopy}>
              <h1>{twin.displayName}</h1>
              </div>
              <div className={styles.heroSummaryActions}>
                <div className={styles.heroActions}>
                  <ShareButton twin={twin} onFeedback={(message, tone) => setFeedback({ message, tone })} />
                  <WatchlistIconButton
                    twin={twin}
                    onFeedback={(message, tone) => setFeedback({ message, tone })}
                  />
                </div>
                <button
                  type="button"
                  className={styles.heroToggle}
                  onClick={() => setHeroExpanded((current) => !current)}
                >
                  {heroExpanded ? "Hide details" : "Expand details"}
                </button>
              </div>
            </div>
          </div>

          {feedback ? (
            <p
              className={
                feedback.tone === "success" ? styles.feedbackSuccess : styles.feedbackError
              }
            >
              {feedback.message}
            </p>
          ) : null}

          {heroExpanded ? (
            <>
              <div className={styles.heroExpanded}>
                <div className={styles.metaRow}>
                  <span className={`${styles.metaPill} ${styles.metaPillWide}`}>Twin ID: {twin.id}</span>
                  <span>Owner: {shortAddress(twin.owner)}</span>
                  <span>Age: {formatAgeLong(twin.ageLabel)}</span>
                </div>
                {twin.description ? <p className={styles.heroDescription}>{twin.description}</p> : null}
              </div>
            </>
          ) : null}
        </section>

        <section className={styles.statsGrid}>
          <div className={styles.statCard}>
            <span>Total Supply</span>
            <strong>{twin.supply.toLocaleString()}</strong>
            <small>Market cap {formatCompactUsd(chartSummary.marketCap)}</small>
          </div>
          <div className={styles.statCard}>
            <span>Unique Holders</span>
            <strong>{twin.holders.toLocaleString()}</strong>
            <small>Active wallet base</small>
          </div>
          <div className={styles.statCard}>
            <span>Total Trades</span>
            <strong>{twin.totalTrades.toLocaleString()}</strong>
            <small>Indexed executions</small>
          </div>
          <div className={styles.statCard}>
            <span>24H Volume</span>
            <strong>{formatCompactUsd(twin.volume24hUsd)}</strong>
            <small>Total volume {formatCompactUsd(twin.totalVolumeUsd)}</small>
          </div>
        </section>

        <TwinPriceChart points={chart} trades={trades} />

        <div className={styles.mobileActionStack}>
          <TradePanel
            twinId={twin.id}
            initialQuote={quote}
            referencePriceUsd={chartSummary.price}
            browseDataWarning={snapshot.error}
          />
          {renderCopilotCard()}
        </div>

        <div className={styles.desktopFeeds}>
          <HoldingsTable holders={holders} />
          <RecentTradesList trades={trades} relativeNowSeconds={relativeNowSeconds} />
        </div>

        <section className={styles.mobileFeeds}>
          <div className={styles.mobileTabs}>
            <button
              type="button"
              className={`${styles.mobileTab} ${
                mobileTab === "trades" ? styles.mobileTabActive : ""
              }`}
              onClick={() => setMobileTab("trades")}
            >
              Recent Trades
            </button>
            <button
              type="button"
              className={`${styles.mobileTab} ${
                mobileTab === "holders" ? styles.mobileTabActive : ""
              }`}
              onClick={() => setMobileTab("holders")}
            >
              Top Holders
            </button>
          </div>
          {mobileTab === "trades" ? (
            <RecentTradesList trades={trades} relativeNowSeconds={relativeNowSeconds} />
          ) : (
            <HoldingsTable holders={holders} />
          )}
        </section>

        <div className={styles.mobileSupplementaryStack}>
          {renderAlertsCard()}
        </div>
      </div>

      <aside className={styles.sideColumn}>
        <TradePanel
          twinId={twin.id}
          initialQuote={quote}
          referencePriceUsd={chartSummary.price}
          browseDataWarning={snapshot.error}
        />

        {renderCopilotCard()}
        {renderAlertsCard()}
      </aside>
    </div>
  )
}
