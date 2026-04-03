"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { QuickBuyControl } from "@/components/quick-buy-control"
import { UiIcon } from "@/components/ui-icon"
import { useWallet } from "@/components/wallet-provider"
import { useWatchlist } from "@/components/watchlist-provider"
import { formatCompactUsd, formatUsd } from "@/lib/currency"
import { buildImageProxyUrl } from "@/lib/image-proxy"
import type { PortfolioPosition, PortfolioSnapshot } from "@/lib/types"
import styles from "./portfolio-page-client.module.css"

type SortKey = "value" | "momentum" | "volume"

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: "value", label: "By value" },
  { key: "momentum", label: "By momentum" },
  { key: "volume", label: "By volume" },
]

function formatBnb(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0.00 BNB"
  }

  return `${value.toFixed(value >= 10 ? 2 : 3)} BNB`
}

function formatChange(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`
}

function shortenAddress(value: string) {
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value
}

function getSyncLabel(error?: string) {
  if (!error) {
    return {
      label: "Live position sync",
      toneClass: styles.syncPillLive,
      dotClass: styles.syncDotLive,
    }
  }

  return {
    label: "Partial sync",
    toneClass: styles.syncPillWarning,
    dotClass: styles.syncDotWarning,
  }
}

function buildDonutGradient(positions: PortfolioPosition[]) {
  if (!positions.length) {
    return "conic-gradient(#22262b 0deg, #22262b 360deg)"
  }

  const palette = ["#a3a6ff", "#63f9bb", "#ff9a6b", "#45484c"]
  let cursor = 0
  const stops = positions.slice(0, 4).map((position, index) => {
    const start = cursor
    const sweep = Math.max(0, Math.min(360, (position.shareOfPortfolioPct / 100) * 360))
    cursor += sweep
    return `${palette[index] ?? palette[palette.length - 1]} ${start.toFixed(1)}deg ${cursor.toFixed(1)}deg`
  })

  if (cursor < 360) {
    stops.push(`#22262b ${cursor.toFixed(1)}deg 360deg`)
  }

  return `conic-gradient(${stops.join(", ")})`
}

function getPositionHint(position: PortfolioPosition) {
  if (position.shareOfPortfolioPct >= 50) {
    return { label: "High concentration", toneClass: styles.flagRisk }
  }
  if (position.twin.holders <= 5) {
    return { label: "Early holder base", toneClass: styles.flagNeutral }
  }
  if (position.twin.volume24hUsd < 500) {
    return { label: "Thin liquidity", toneClass: styles.flagNeutral }
  }
  return null
}

function TwinAvatar({ position }: { position: PortfolioPosition }) {
  const [broken, setBroken] = useState(false)
  const initials = position.twin.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")

  if (position.twin.avatarUrl && !broken) {
    return (
      <div className={styles.avatarFrame}>
        <img
          src={buildImageProxyUrl(position.twin.avatarUrl)}
          alt=""
          className={styles.avatarImage}
          onError={() => setBroken(true)}
        />
      </div>
    )
  }

  return <div className={styles.avatarFrame}>{initials || "TK"}</div>
}

export function PortfolioPageClient() {
  const { account, connect, connecting } = useWallet()
  const { isWatched, toggle, hydrated, loading: watchlistLoading } = useWatchlist()
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>("value")
  const [pendingWatchId, setPendingWatchId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!account) {
        setSnapshot(null)
        setPageError(null)
        setLoading(false)
        return
      }

      setLoading(true)
      try {
        const response = await fetch(
          `/api/portfolio?account=${encodeURIComponent(account)}`,
          { cache: "no-store" }
        )
        const payload = (await response.json()) as PortfolioSnapshot & { error?: string }

        if (!response.ok) {
          throw new Error(payload.error || "Failed to load portfolio.")
        }

        if (!cancelled) {
          setSnapshot(payload)
          setPageError(null)
        }
      } catch (cause) {
        if (!cancelled) {
          setSnapshot(null)
          setPageError(cause instanceof Error ? cause.message : "Failed to load portfolio.")
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [account])

  const livePositions = useMemo(
    () =>
      (snapshot?.positions ?? []).map((position) => ({
        ...position,
        watched: isWatched(position.twin.id),
      })),
    [isWatched, snapshot?.positions]
  )

  const positions = useMemo(() => {
    return [...livePositions].sort((left, right) => {
      switch (sortKey) {
        case "momentum":
          return right.twin.change1hPct - left.twin.change1hPct
        case "volume":
          return right.twin.volume24hUsd - left.twin.volume24hUsd
        case "value":
        default:
          return right.positionValueUsd - left.positionValueUsd
      }
    })
  }, [livePositions, sortKey])

  const concentrationBase = useMemo(
    () => [...livePositions].sort((left, right) => right.positionValueUsd - left.positionValueUsd),
    [livePositions]
  )

  const concentrationSlices = useMemo(() => {
    const top = concentrationBase.slice(0, 3).map((position) => ({
      twinId: position.twin.id,
      label: position.twin.displayName,
      sharePct: position.shareOfPortfolioPct,
      valueUsd: position.positionValueUsd,
    }))

    if (concentrationBase.length <= 3) {
      return top
    }

    const otherPositions = concentrationBase.slice(3)
    return [
      ...top,
      {
        twinId: "other",
        label: `Other (${otherPositions.length})`,
        sharePct: otherPositions.reduce((sum, position) => sum + position.shareOfPortfolioPct, 0),
        valueUsd: otherPositions.reduce((sum, position) => sum + position.positionValueUsd, 0),
      },
    ]
  }, [concentrationBase])

  const watchedPositions = useMemo(
    () => concentrationBase.filter((position) => position.watched).slice(0, 4),
    [concentrationBase]
  )

  const syncState = getSyncLabel(pageError ?? snapshot?.error)
  const leadInsight = snapshot?.insights[0] ?? null
  const secondaryInsights = snapshot?.insights.slice(1) ?? []

  async function handleWatchToggle(position: PortfolioPosition) {
    setActionError(null)
    setPendingWatchId(position.twin.id)
    try {
      await toggle(position.twin)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Watchlist update failed.")
    } finally {
      setPendingWatchId(null)
    }
  }

  if (!account) {
    return (
      <div className={styles.page}>
        <header className={styles.hero}>
          <div>
            <h1 className={styles.title}>Portfolio</h1>
            <p className={styles.subtitle}>Connected-wallet twin positions, sized for live action.</p>
          </div>
        </header>

        <section className={styles.emptyPanel}>
          <h2>Connect your wallet to load positions</h2>
          <p>
            This page pulls held twin keys, live buy and exit quotes, wallet balance, and watchlist
            overlap into one operating view.
          </p>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void connect()}
            disabled={connecting}
          >
            {connecting ? "Connecting..." : "Connect wallet"}
          </button>
        </section>
      </div>
    )
  }

  if (loading) {
    return (
      <div className={styles.page}>
        <header className={styles.hero}>
          <div>
            <h1 className={styles.title}>Portfolio</h1>
            <p className={styles.subtitle}>Loading held twins, quotes, and wallet balance.</p>
          </div>
          <div className={`${styles.syncPill} ${syncState.toneClass}`}>
            <span className={`${styles.syncDot} ${syncState.dotClass}`} />
            {syncState.label}
          </div>
        </header>

        <section className={styles.emptyPanel}>
          <h2>Syncing portfolio</h2>
          <p>Pulling wallet-held twin positions and live market reads into the terminal.</p>
        </section>
      </div>
    )
  }

  if (pageError && !snapshot) {
    return (
      <div className={styles.page}>
        <header className={styles.hero}>
          <div>
            <h1 className={styles.title}>Portfolio</h1>
            <p className={styles.subtitle}>Connected wallet positions across the TradeKeys twin market.</p>
          </div>
          <div className={`${styles.syncPill} ${syncState.toneClass}`}>
            <span className={`${styles.syncDot} ${syncState.dotClass}`} />
            {syncState.label}
          </div>
        </header>

        <section className={styles.emptyPanel}>
          <h2>Portfolio sync failed</h2>
          <p>{pageError}</p>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </section>
      </div>
    )
  }

  if (!snapshot) {
    return null
  }

  if (snapshot.positions.length === 0) {
    return (
      <div className={styles.page}>
        <header className={styles.hero}>
          <div>
            <h1 className={styles.title}>Portfolio</h1>
            <p className={styles.subtitle}>No open twin positions are currently held by this wallet.</p>
          </div>
          <div className={`${styles.syncPill} ${syncState.toneClass}`}>
            <span className={`${styles.syncDot} ${syncState.dotClass}`} />
            {syncState.label}
          </div>
        </header>

        <section className={styles.summaryGrid}>
          <article className={`${styles.metricCard} ${styles.metricCardLead}`}>
            <span className={styles.metricLabel}>Portfolio value</span>
            <strong className={styles.metricValue}>{formatUsd(0)}</strong>
            <span className={styles.metricDetail}>{formatBnb(snapshot.availableBnb)} available</span>
          </article>
          <article className={styles.metricCard}>
            <span className={styles.metricLabel}>Open twin positions</span>
            <strong className={styles.metricValueSmall}>0</strong>
          </article>
          <article className={styles.metricCard}>
            <span className={styles.metricLabel}>Available BNB</span>
            <strong className={styles.metricValueSmall}>{formatBnb(snapshot.availableBnb)}</strong>
          </article>
        </section>

        <section className={styles.emptyPanel}>
          <h2>No twin keys held yet</h2>
          <p>
            {snapshot.error
              ? snapshot.error
              : "Once this wallet buys into a twin, the position will appear here with live buy and exit quotes, concentration share, and portfolio signals."}
          </p>
          <Link href="/" className={styles.primaryButton}>
            Explore market
          </Link>
        </section>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <h1 className={styles.title}>Portfolio</h1>
          <p className={styles.subtitle}>Connected wallet positions across the TradeKeys twin market.</p>
        </div>
        <div className={styles.heroMeta}>
          <div className={styles.walletChip}>
            <UiIcon name="wallet" className={styles.walletIcon} />
            <span>{shortenAddress(account)}</span>
          </div>
          <div className={`${styles.syncPill} ${syncState.toneClass}`}>
            <span className={`${styles.syncDot} ${syncState.dotClass}`} />
            {syncState.label}
          </div>
        </div>
      </header>

      <section className={styles.summaryGrid}>
        <article className={`${styles.metricCard} ${styles.metricCardLead}`}>
          <span className={styles.metricLabel}>Portfolio value</span>
          <strong className={styles.metricValue}>{formatUsd(snapshot.portfolioValueUsd)}</strong>
          <span className={styles.metricDetail}>{formatBnb(snapshot.portfolioValueBnb)} exit value</span>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Open twin positions</span>
          <strong className={styles.metricValueSmall}>{positions.length}</strong>
          <span className={styles.metricDetail}>Held across this connected wallet</span>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Available BNB</span>
          <strong className={styles.metricValueSmall}>{formatBnb(snapshot.availableBnb)}</strong>
          <span className={styles.metricDetail}>{formatUsd(snapshot.availableUsd)} wallet balance</span>
        </article>
      </section>

      <section className={styles.insightBand}>
        <div className={styles.insightLead}>
          <div className={styles.insightBadge}>
            <UiIcon name="robot" className={styles.insightBadgeIcon} />
            <span>{leadInsight?.label ?? "Portfolio insight"}</span>
          </div>
          <div>
            <strong>{leadInsight?.headline ?? "Live position monitoring is active."}</strong>
            <p>
              {leadInsight?.summary ??
                "Held twins are being ranked by live exit value, 1H move, and portfolio concentration."}
            </p>
          </div>
        </div>
        {secondaryInsights.length > 0 ? (
          <div className={styles.insightTrail}>
            {secondaryInsights.map((insight) => (
              <div key={insight.id} className={styles.insightChip}>
                <span>{insight.label}</span>
                <strong>{insight.headline}</strong>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <div className={styles.workspace}>
        <section className={styles.positionsSection}>
          <div className={styles.sectionTopbar}>
            <div>
              <h2 className={styles.sectionTitle}>Active twin positions</h2>
              <p className={styles.sectionCopy}>
                Mobile-first position cards with live add, reduce, and watchlist actions.
              </p>
            </div>
            <div className={styles.sortChips} role="tablist" aria-label="Sort portfolio positions">
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`${styles.sortChip} ${sortKey === option.key ? styles.sortChipActive : ""}`}
                  onClick={() => setSortKey(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {actionError ? <div className={styles.inlineError}>{actionError}</div> : null}

          <div className={styles.positionGrid}>
            {positions.map((position) => {
              const hint = getPositionHint(position)
              const isPositive = position.twin.change1hPct > 0
              const isNegative = position.twin.change1hPct < 0

              return (
                <article
                  key={position.twin.id}
                  className={`${styles.positionCard} ${
                    isPositive
                      ? styles.positionCardPositive
                      : isNegative
                        ? styles.positionCardNegative
                        : styles.positionCardNeutral
                  }`}
                >
                  <div className={styles.positionTop}>
                    <div className={styles.positionIdentity}>
                      <TwinAvatar position={position} />
                      <div className={styles.positionIdentityText}>
                        <div className={styles.positionTitleRow}>
                          <Link href={`/twin/${position.twin.id}`} className={styles.positionTitle}>
                            {position.twin.displayName}
                          </Link>
                          {position.watched ? (
                            <span className={`${styles.miniBadge} ${styles.miniBadgeWatched}`}>Watched</span>
                          ) : null}
                        </div>
                        <p>
                          {position.heldKeys.toLocaleString()} keys <span>&bull;</span> Supply{" "}
                          {position.twin.supply.toLocaleString()}
                        </p>
                      </div>
                    </div>

                    <div
                      className={`${styles.positionChange} ${
                        isPositive
                          ? styles.changePositive
                          : isNegative
                            ? styles.changeNegative
                            : styles.changeNeutral
                      }`}
                    >
                      <strong>{formatChange(position.twin.change1hPct)}</strong>
                      <span>Indexed 1H change</span>
                    </div>
                  </div>

                  <div className={styles.positionStats}>
                    <div className={styles.statBlock}>
                      <span>Position value</span>
                      <strong>{formatUsd(position.positionValueUsd)}</strong>
                    </div>
                    <div className={styles.statBlock}>
                      <span>24H volume</span>
                      <strong>{formatCompactUsd(position.twin.volume24hUsd)}</strong>
                    </div>
                    <div className={styles.statBlock}>
                      <span>Holders</span>
                      <strong>{position.twin.holders.toLocaleString()}</strong>
                    </div>
                    <div className={styles.statBlock}>
                      <span>Portfolio share</span>
                      <strong>{position.shareOfPortfolioPct.toFixed(0)}%</strong>
                    </div>
                  </div>

                  <div className={styles.quoteRow}>
                    <div className={styles.quoteCard}>
                      <span>Buy 1 key</span>
                      <strong>{formatUsd(position.buyOneKeyUsd)}</strong>
                    </div>
                    <div className={styles.quoteCard}>
                      <span>Exit value</span>
                      <strong>{formatUsd(position.positionValueUsd)}</strong>
                    </div>
                  </div>

                  <div className={styles.cardFooter}>
                    <div className={styles.footerSignals}>
                      {hint ? <span className={`${styles.flag} ${hint.toneClass}`}>{hint.label}</span> : null}
                      <span className={styles.metaChip}>{position.twin.holders.toLocaleString()} holders</span>
                    </div>
                    <Link href={`/twin/${position.twin.id}`} className={styles.inlineLink}>
                      View twin
                    </Link>
                  </div>

                  <div className={styles.actionRow}>
                    <div className={styles.buyAction}>
                      <QuickBuyControl twinId={position.twin.id} variant="card" buttonLabel="Buy more" />
                    </div>
                    <Link href={`/twin/${position.twin.id}`} className={styles.reduceAction}>
                      Reduce
                    </Link>
                    <button
                      type="button"
                      className={styles.watchAction}
                      onClick={() => void handleWatchToggle(position)}
                      disabled={pendingWatchId === position.twin.id || !hydrated || watchlistLoading}
                      aria-label={position.watched ? "Remove from watchlist" : "Add to watchlist"}
                      title={position.watched ? "Remove from watchlist" : "Add to watchlist"}
                    >
                      <UiIcon name="star" className={styles.watchIcon} />
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <aside className={styles.rail}>
          <section className={styles.railPanel}>
            <div className={styles.railHeader}>
              <div>
                <span className={styles.railEyebrow}>Portfolio concentration</span>
                <h3>Current exposure</h3>
              </div>
              <UiIcon name="pie" className={styles.railIcon} />
            </div>

            <div className={styles.donutWrap}>
              <div
                className={styles.donut}
                style={{ backgroundImage: buildDonutGradient(concentrationBase) }}
              >
                <div className={styles.donutCenter}>
                  <strong>{(concentrationBase[0]?.shareOfPortfolioPct ?? 0).toFixed(0)}%</strong>
                  <span>Top twin</span>
                </div>
              </div>
            </div>

            <div className={styles.sliceList}>
              {concentrationSlices.map((slice, index) => (
                <div key={slice.twinId} className={styles.sliceRow}>
                  <div className={styles.sliceLabel}>
                    <span
                      className={styles.sliceSwatch}
                      style={{
                        background:
                          ["#a3a6ff", "#63f9bb", "#ff9a6b", "#45484c"][index] ?? "#45484c",
                      }}
                    />
                    <strong>{slice.label}</strong>
                  </div>
                  <span>{slice.sharePct.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.railPanel}>
            <div className={styles.railHeader}>
              <div>
                <span className={styles.railEyebrow}>Watchlist overlap</span>
                <h3>{watchedPositions.length} held twin{watchedPositions.length === 1 ? "" : "s"} pinned</h3>
              </div>
              <UiIcon name="star" className={styles.railIcon} />
            </div>

            {watchedPositions.length > 0 ? (
              <div className={styles.watchList}>
                {watchedPositions.map((position) => (
                  <div key={position.twin.id} className={styles.watchRow}>
                    <div>
                      <strong>{position.twin.displayName}</strong>
                      <span>{formatUsd(position.positionValueUsd)} held</span>
                    </div>
                    <span
                      className={`${styles.watchRowChange} ${
                        position.twin.change1hPct > 0
                          ? styles.changePositive
                          : position.twin.change1hPct < 0
                            ? styles.changeNegative
                            : styles.changeNeutral
                      }`}
                    >
                      {formatChange(position.twin.change1hPct)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.railCopy}>
                No held twins are pinned yet. Use the star action on any position to keep it in your
                watchlist follow-up flow.
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}
