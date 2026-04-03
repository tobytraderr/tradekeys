"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { formatUsd } from "@/lib/currency"
import { buildImageProxyUrl } from "@/lib/image-proxy"
import type {
  WatchlistDashboardItem,
  WatchlistDashboardSnapshot,
} from "@/lib/types"
import { QuickBuyControl } from "@/components/quick-buy-control"
import { useWallet } from "@/components/wallet-provider"
import { useWatchlist } from "@/components/watchlist-provider"
import styles from "./watchlist-page-client.module.css"

type SortKey = "recent" | "movers" | "volume" | "holders"

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: "recent", label: "Most active" },
  { key: "movers", label: "Biggest movers" },
  { key: "volume", label: "Highest volume" },
  { key: "holders", label: "Largest holder base" },
]

const compactUsdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
})

function getFeedStatus(error?: string) {
  if (!error) {
    return {
      label: "Indexed market feed",
      toneClass: styles.feedPillRealtime,
      dotClass: styles.feedDotRealtime,
    }
  }

  const normalized = error.toLowerCase()
  if (normalized.includes("cached")) {
    return {
      label: "Cached indexed feed",
      toneClass: styles.feedPillCached,
      dotClass: styles.feedDotWarning,
    }
  }

  if (normalized.includes("rate-limit") || normalized.includes("rate limit") || normalized.includes("429")) {
    return {
      label: "Rate-limited indexed feed",
      toneClass: styles.feedPillWarning,
      dotClass: styles.feedDotWarning,
    }
  }

  return {
    label: "Market unavailable",
    toneClass: styles.feedPillUnavailable,
    dotClass: styles.feedDotUnavailable,
  }
}

function formatCompactUsd(value: number) {
  return compactUsdFormatter.format(value)
}

function formatChange(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`
}

function getChangeLabel(source: WatchlistDashboardItem["change1hSource"]) {
  return source === "live" ? "Live 1H change" : "Indexed 1H change"
}

function formatMarketUsd(value: number) {
  if (!Number.isFinite(value)) {
    return "Unavailable"
  }

  if (value > 0 && value < 0.01) {
    return formatUsd(value, { minimumFractionDigits: 4, maximumFractionDigits: 4 })
  }

  return formatUsd(value)
}

function formatQuoteUsd(value: number, quoteWei: string) {
  const hasLiveQuote = quoteWei !== "0"
  if (!hasLiveQuote) {
    return "Unavailable"
  }

  if (value > 0 && value < 0.01) {
    return formatUsd(value, { minimumFractionDigits: 4, maximumFractionDigits: 4 })
  }

  if (value === 0) {
    return "$0.00"
  }

  return formatUsd(value)
}

function formatRelativeTime(timestamp?: number, relativeNowMs?: number | null) {
  if (!timestamp || !relativeNowMs) {
    return "--"
  }

  const deltaSeconds = Math.max(0, Math.floor((relativeNowMs - timestamp * 1000) / 1000))
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`
  const deltaMinutes = Math.floor(deltaSeconds / 60)
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`
  const deltaHours = Math.floor(deltaMinutes / 60)
  if (deltaHours < 24) return `${deltaHours}h ago`
  const deltaDays = Math.floor(deltaHours / 24)
  return `${deltaDays}d ago`
}

function buildSparklinePath(values: number[]) {
  if (values.length <= 1) {
    return "M 0 24 L 100 24"
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100
      const y = 28 - ((value - min) / range) * 22
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(" ")
}

function getInitialSelection(items: WatchlistDashboardItem[]) {
  return items[0]?.twin.id ?? null
}

function shortenTwinId(id: string) {
  if (id.length <= 16) return id
  return `${id.slice(0, 6)}...${id.slice(-4)}`
}

export function WatchlistPageClient() {
  const { account, connect, connecting, ensureSession } = useWallet()
  const {
    hydrated,
    loading: watchlistLoading,
    error: watchlistError,
    ids,
    remove,
  } = useWatchlist()
  const [snapshot, setSnapshot] = useState<WatchlistDashboardSnapshot>({ items: [] })
  const [loading, setLoading] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("recent")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [relativeNowMs, setRelativeNowMs] = useState<number | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [analysisModalId, setAnalysisModalId] = useState<string | null>(null)
  const [compactSortOpen, setCompactSortOpen] = useState(false)
  const compactSortRef = useRef<HTMLDivElement | null>(null)

  const idsSignature = ids.join("|")

  const refreshDashboard = useCallback(async () => {
    if (!account) {
      setSnapshot({ items: [] })
      setPageError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      await ensureSession()
      const response = await fetch(
        `/api/watchlist/dashboard?account=${encodeURIComponent(account)}`,
        { cache: "no-store" }
      )
      const payload = (await response.json()) as WatchlistDashboardSnapshot & { error?: string }

      if (!response.ok) {
        throw new Error(payload.error || "Failed to load watchlist dashboard.")
      }

      setSnapshot({
        items: Array.isArray(payload.items) ? payload.items : [],
        ...(payload.error ? { error: payload.error } : {}),
      })
      setPageError(null)
    } catch (cause) {
      setPageError(
        cause instanceof Error ? cause.message : "Failed to load watchlist dashboard."
      )
    } finally {
      setLoading(false)
    }
  }, [account, ensureSession])

  useEffect(() => {
    setRelativeNowMs(Date.now())
    const interval = window.setInterval(() => {
      setRelativeNowMs(Date.now())
    }, 60_000)

    return () => {
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!compactSortRef.current?.contains(event.target as Node)) {
        setCompactSortOpen(false)
      }
    }

    document.addEventListener("mousedown", handlePointerDown)
    return () => document.removeEventListener("mousedown", handlePointerDown)
  }, [])

  useEffect(() => {
    if (!account) {
      setSnapshot({ items: [] })
      setSelectedId(null)
      setPinnedId(null)
      setHoveredId(null)
      setPageError(null)
      return
    }

    if (!hydrated) {
      return
    }

    if (!ids.length) {
      setSnapshot({ items: [] })
      setSelectedId(null)
      setPinnedId(null)
      setHoveredId(null)
      setPageError(null)
      return
    }

    void refreshDashboard()
  }, [account, hydrated, ids.length, idsSignature, refreshDashboard])

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const baseItems = normalizedQuery
      ? snapshot.items.filter((item) => {
          const haystack = [
            item.twin.displayName,
            item.twin.id,
            item.twin.owner,
          ]
            .join(" ")
            .toLowerCase()

          return haystack.includes(normalizedQuery)
        })
      : snapshot.items

    const sorted = [...baseItems]
    sorted.sort((left, right) => {
      switch (sortKey) {
        case "movers":
          return (
            Math.abs(right.change1hPct) - Math.abs(left.change1hPct) ||
            right.change1hPct - left.change1hPct
          )
        case "volume":
          return right.twin.volume24hUsd - left.twin.volume24hUsd
        case "holders":
          return right.twin.holders - left.twin.holders
        case "recent":
        default:
          return (right.twin.lastTradeAt ?? 0) - (left.twin.lastTradeAt ?? 0)
      }
    })

    return sorted
  }, [query, snapshot.items, sortKey])

  useEffect(() => {
    const availableIds = new Set(filteredItems.map((item) => item.twin.id))
    if (!availableIds.size) {
      setSelectedId(null)
      setPinnedId(null)
      setHoveredId(null)
      return
    }

    if (selectedId && availableIds.has(selectedId)) {
      return
    }

    const nextId = getInitialSelection(filteredItems)
    setSelectedId(nextId)
    setPinnedId(null)
    setHoveredId(null)
  }, [filteredItems, selectedId])

  const activeId =
    pinnedId && filteredItems.some((item) => item.twin.id === pinnedId)
      ? pinnedId
      : hoveredId && filteredItems.some((item) => item.twin.id === hoveredId)
        ? hoveredId
        : selectedId

  const activeItem =
    filteredItems.find((item) => item.twin.id === activeId) ?? filteredItems[0] ?? null
  const modalItem =
    filteredItems.find((item) => item.twin.id === analysisModalId) ??
    snapshot.items.find((item) => item.twin.id === analysisModalId) ??
    null

  const feedError = pageError ?? snapshot.error ?? watchlistError ?? undefined
  const feedStatus = getFeedStatus(feedError)

  async function handleRemove(twinId: string) {
    try {
      setRemovingId(twinId)
      await remove(twinId)
      setSnapshot((current) => ({
        ...current,
        items: current.items.filter((item) => item.twin.id !== twinId),
      }))
      if (selectedId === twinId) {
        setSelectedId(null)
      }
      if (pinnedId === twinId) {
        setPinnedId(null)
      }
      if (hoveredId === twinId) {
        setHoveredId(null)
      }
      if (analysisModalId === twinId) {
        setAnalysisModalId(null)
      }
    } catch {
      // Provider already exposes a user-facing error.
    } finally {
      setRemovingId(null)
    }
  }

  function handleActivate(twinId: string) {
    setSelectedId(twinId)
    setPinnedId((current) => (current === twinId ? null : twinId))
  }

  function handlePreview(twinId: string) {
    if (!pinnedId) {
      setHoveredId(twinId)
    }
  }

  function handlePreviewEnd() {
    if (!pinnedId) {
      setHoveredId(null)
    }
  }

  const emptyState = account && hydrated && !watchlistLoading && !loading && filteredItems.length === 0
  const activeSortLabel =
    SORT_OPTIONS.find((option) => option.key === sortKey)?.label ?? "Most active"

  return (
    <div className={styles.page}>
      <section className={styles.main}>
        <header className={styles.hero}>
          <div>
            <h1 className={styles.title}>Watchlist</h1>
            <p className={styles.subtitle}>
              Monitoring {snapshot.items.length} active twin{snapshot.items.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className={`${styles.feedPill} ${feedStatus.toneClass}`}>
            <span className={`${styles.feedDot} ${feedStatus.dotClass}`} />
            {feedStatus.label}
          </div>
        </header>

        <section className={styles.controls}>
          <label className={styles.search}>
            <span className={styles.searchIcon}>Search</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter twins..."
            />
          </label>

          <div className={styles.sortGroup}>
            <div
              className={styles.sortGroupFull}
              role="tablist"
              aria-label="Watchlist sorting"
            >
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`${styles.sortChip} ${
                    sortKey === option.key ? styles.sortChipActive : ""
                  }`}
                  onClick={() => setSortKey(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className={styles.sortGroupCompact}>
              <button
                type="button"
                className={`${styles.sortChip} ${styles.sortChipActive} ${styles.sortChipPrimary}`}
                aria-label={`Current sort: ${activeSortLabel}`}
              >
                {activeSortLabel}
              </button>
              <div className={styles.sortSwitcher} ref={compactSortRef}>
                <button
                  type="button"
                  className={styles.sortSwitcherButton}
                  aria-haspopup="menu"
                  aria-expanded={compactSortOpen}
                  aria-label="Change watchlist sorting"
                  onClick={() => setCompactSortOpen((current) => !current)}
                >
                  <span className={styles.sortSwitcherLabel}>Sort</span>
                  <span className={styles.sortSwitcherValue}>{activeSortLabel}</span>
                </button>
                {compactSortOpen ? (
                  <div className={styles.sortSwitcherMenu} role="menu" aria-label="Watchlist sorting">
                    {SORT_OPTIONS.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        role="menuitemradio"
                        aria-checked={sortKey === option.key}
                        className={`${styles.sortMenuItem} ${
                          sortKey === option.key ? styles.sortMenuItemActive : ""
                        }`}
                        onClick={() => {
                          setSortKey(option.key)
                          setCompactSortOpen(false)
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        {!account ? (
          <section className={styles.emptyPanel}>
            <h2>Connect to load your watchlist</h2>
            <p>
              Your watchlist is persisted per wallet in the database. Connect once and this page
              becomes your live monitoring surface.
            </p>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => void connect()}
              disabled={connecting}
            >
              {connecting ? "Connecting..." : "Connect wallet"}
            </button>
          </section>
        ) : !hydrated || watchlistLoading || loading ? (
          <section className={styles.emptyPanel}>
            <h2>Loading watchlist</h2>
            <p>Pulling saved twins, live quotes, and quick analysis into the terminal.</p>
          </section>
        ) : emptyState ? (
          <section className={styles.emptyPanel}>
            <h2>No twins match this view</h2>
            <p>
              {snapshot.items.length === 0
                ? "Add twins from the homepage or a detail page, then come back here to monitor them."
                : "Try another search or sort to bring a saved twin back into focus."}
            </p>
            <Link href="/" className={styles.primaryButton}>
              Explore twins
            </Link>
          </section>
        ) : (
          <>
            <section className={styles.tablePanel}>
              <div className={styles.tableHeader}>
                <div>Twin</div>
                <div>Current price</div>
                <div>1H change</div>
                <div>24H volume</div>
                <div>Trend</div>
                <div className={styles.actionsHead}>Actions</div>
              </div>

              <div className={styles.rows}>
                {filteredItems.map((item) => {
                  const isActive = activeItem?.twin.id === item.twin.id
                  const sparklinePath = buildSparklinePath(item.trend)
                  const currentPrice = item.currentPriceUsd

                  return (
                    <article
                      key={item.twin.id}
                      className={`${styles.row} ${isActive ? styles.rowActive : ""}`}
                      onMouseEnter={() => handlePreview(item.twin.id)}
                      onMouseLeave={handlePreviewEnd}
                      onFocus={() => handlePreview(item.twin.id)}
                      onBlur={handlePreviewEnd}
                      onClick={() => handleActivate(item.twin.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          handleActivate(item.twin.id)
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className={styles.twinCell}>
                        <TwinAvatar twin={item.twin} />
                        <div className={styles.twinMeta}>
                          <strong>{item.twin.displayName}</strong>
                          <span>{shortenTwinId(item.twin.id)}</span>
                        </div>
                      </div>

                      <div className={styles.metricCell}>
                        <span className={styles.mobileLabel}>Current price</span>
                        <strong>{formatMarketUsd(currentPrice)}</strong>
                      </div>

                      <div
                        className={`${styles.metricCell} ${
                          item.change1hPct > 0
                            ? styles.positive
                            : item.change1hPct < 0
                              ? styles.negative
                              : styles.neutral
                        }`}
                      >
                        <span className={styles.mobileLabel}>{getChangeLabel(item.change1hSource)}</span>
                        <strong>{formatChange(item.change1hPct)}</strong>
                      </div>

                      <div className={styles.metricCell}>
                        <span className={styles.mobileLabel}>24H volume</span>
                        <strong>{formatCompactUsd(item.twin.volume24hUsd)}</strong>
                      </div>

                      <div className={styles.trendCell}>
                        <span className={styles.mobileLabel}>Trend</span>
                        <svg viewBox="0 0 100 32" className={styles.sparkline} aria-hidden="true">
                          <path
                            d={sparklinePath}
                            className={
                              item.change1hPct > 0
                                ? styles.sparklinePositive
                                : item.change1hPct < 0
                                  ? styles.sparklineNegative
                                  : styles.sparklineNeutral
                            }
                          />
                        </svg>
                      </div>

                      <div className={styles.rowActions} onClick={(event) => event.stopPropagation()}>
                        <button
                          type="button"
                          className={`${styles.secondaryButton} ${styles.mobileOnlyAction}`}
                          onClick={() => setAnalysisModalId(item.twin.id)}
                        >
                          Quick analysis
                        </button>
                        <Link href={`/twin/${item.twin.id}`} className={styles.secondaryButton}>
                          View
                        </Link>
                        <button
                          type="button"
                          className={styles.ghostButton}
                          onClick={() => void handleRemove(item.twin.id)}
                          disabled={removingId === item.twin.id}
                        >
                          {removingId === item.twin.id ? "Removing..." : "Remove"}
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          </>
        )}
      </section>

      <aside className={styles.side}>
        {account && hydrated && !watchlistLoading && !loading && activeItem ? (
          <AnalysisPanel
            item={activeItem}
            pinned={Boolean(pinnedId)}
            feedError={feedError}
            relativeNowMs={relativeNowMs}
            onFollowHover={() => setPinnedId(null)}
            onRemove={handleRemove}
            removing={removingId === activeItem.twin.id}
          />
        ) : (
          <section className={styles.sidePlaceholder}>
            <h2>Quick analysis</h2>
            <p>Select a watched twin to open the live quote, identity snapshot, and copilot readout.</p>
          </section>
        )}
      </aside>

      {analysisModalId ? (
        <div
          className={styles.modalOverlay}
          role="presentation"
          onClick={() => setAnalysisModalId(null)}
        >
          <div
            className={styles.modalShell}
            role="dialog"
            aria-modal="true"
            aria-label="Quick analysis"
            onClick={(event) => event.stopPropagation()}
          >
            {modalItem ? (
              <AnalysisPanel
                item={modalItem}
                pinned
                feedError={feedError}
                relativeNowMs={relativeNowMs}
                onFollowHover={() => setAnalysisModalId(null)}
                onRemove={handleRemove}
                removing={removingId === modalItem.twin.id}
                modal
                onClose={() => setAnalysisModalId(null)}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function TwinAvatar({ twin }: { twin: WatchlistDashboardItem["twin"] }) {
  const [broken, setBroken] = useState(false)
  const initials = twin.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")

  const canRenderImage = Boolean(twin.avatarUrl && !broken)

  return (
    <div className={styles.avatarFrame}>
      {canRenderImage ? (
        <img
          src={buildImageProxyUrl(twin.avatarUrl!)}
          alt=""
          className={styles.avatarImage}
          onError={() => setBroken(true)}
        />
      ) : (
        <span>{initials || twin.displayName.slice(0, 2).toUpperCase()}</span>
      )}
    </div>
  )
}

function AnalysisPanel({
  item,
  pinned,
  feedError,
  relativeNowMs,
  onFollowHover,
  onRemove,
  removing,
  modal = false,
  onClose,
}: {
  item: WatchlistDashboardItem
  pinned: boolean
  feedError?: string
  relativeNowMs: number | null
  onFollowHover: () => void
  onRemove: (id: string) => Promise<void>
  removing: boolean
  modal?: boolean
  onClose?: () => void
}) {
  const currentPrice = item.currentPriceUsd
  const buyQuotePrice = Number(item.quote.buyQuoteUsd)
  const insightToneClass =
    item.insight.tone === "bullish"
      ? styles.insightBullish
      : item.insight.tone === "bearish"
        ? styles.insightBearish
        : styles.insightNeutral

  return (
    <section className={`${styles.analysisPanel} ${modal ? styles.analysisPanelModal : ""}`}>
      <div className={styles.analysisTopbar}>
        <span className={styles.analysisTag}>Quick analysis</span>
        {modal ? (
          <button type="button" className={styles.ghostButton} onClick={onClose}>
            Close
          </button>
        ) : pinned ? (
          <button type="button" className={styles.ghostButton} onClick={onFollowHover}>
            Follow hover
          </button>
        ) : (
          <span className={styles.analysisHint}>Preview follows focus. Tap or click to pin.</span>
        )}
      </div>

      <div className={styles.analysisHeader}>
        <div className={styles.analysisIdentity}>
          <h2>{item.twin.displayName}</h2>
          <p>{item.error ?? "Live monitoring from your persisted watchlist."}</p>
        </div>
      </div>

      <div className={styles.quoteGrid}>
        <div className={`${styles.quoteCard} ${styles.buyQuote}`}>
          <span>Current price</span>
          <strong>{formatMarketUsd(currentPrice)}</strong>
        </div>
        <div className={`${styles.quoteCard} ${styles.sellQuote}`}>
          <span>Live buy quote (USD display)</span>
          <strong>{formatQuoteUsd(buyQuotePrice, item.quote.buyQuoteWei)}</strong>
        </div>
      </div>
      <p className={styles.analysisHint}>
        Trading still settles from a live onchain BNB quote. These USD values are display-only.
      </p>

      <div className={styles.identityList}>
        <div>
          <span>Twin ID</span>
          <strong>{item.twin.id}</strong>
        </div>
        <div>
          <span>Owner</span>
          <strong>{item.twin.owner}</strong>
        </div>
        <div>
          <span>Supply</span>
          <strong>{item.twin.supply.toLocaleString()} keys</strong>
        </div>
        <div>
          <span>Holders</span>
          <strong>{item.twin.holders.toLocaleString()}</strong>
        </div>
        <div>
          <span>{item.tradeCountLabel}</span>
          <strong>{item.tradeCountValue.toLocaleString()}</strong>
        </div>
        <div>
          <span>Last trade</span>
          <strong>{formatRelativeTime(item.twin.lastTradeAt, relativeNowMs)}</strong>
        </div>
      </div>

      <div className={`${styles.insightCard} ${insightToneClass}`}>
        <span className={styles.insightLabel}>{item.insight.label}</span>
        <h3>{item.insight.headline}</h3>
        <p>{item.insight.summary}</p>
        <ul className={styles.signalList}>
          {item.insight.signals.slice(0, 4).map((signal) => (
            <li key={signal}>{signal}</li>
          ))}
        </ul>
        <p className={styles.insightAction}>{item.insight.action}</p>
      </div>

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <span>24H volume</span>
          <strong>{formatCompactUsd(item.twin.volume24hUsd)}</strong>
        </div>
        <div className={styles.statCard}>
          <span>1H volume</span>
          <strong>{formatCompactUsd(item.volume1hUsd)}</strong>
        </div>
        <div className={styles.statCard}>
          <span>{getChangeLabel(item.change1hSource)}</span>
          <strong>{formatChange(item.change1hPct)}</strong>
        </div>
        <div className={styles.statCard}>
          <span>Market cap</span>
          <strong>{formatCompactUsd(item.twin.supply * item.twin.lastPriceUsd)}</strong>
        </div>
      </div>

      <div className={styles.analysisActions}>
        <div className={styles.quickBuyWrap}>
          <QuickBuyControl
            twinId={item.twin.id}
            variant="card"
            buttonLabel="Quick buy"
            browseDataWarning={feedError ?? item.error ?? undefined}
          />
        </div>
        <Link href={`/twin/${item.twin.id}`} className={styles.primaryButton}>
          View twin
        </Link>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => void onRemove(item.twin.id)}
          disabled={removing}
        >
          {removing ? "Removing..." : "Remove from watchlist"}
        </button>
      </div>
    </section>
  )
}
