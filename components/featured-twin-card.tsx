import Link from "next/link"
import { formatUsd } from "@/lib/currency"
import { buildImageProxyUrl } from "@/lib/image-proxy"
import type { FeaturedTwin } from "@/lib/types"

type Props = {
  featured: FeaturedTwin
}

export function FeaturedTwinCard({ featured }: Props) {
  const liveQuoteUsd = Number(featured.quote?.buyQuoteUsd)
  const quoteUsd = formatUsd(
    Number.isFinite(liveQuoteUsd) && liveQuoteUsd > 0
      ? liveQuoteUsd
      : featured.twin.lastPriceUsd
  )
  const feeShare = featured.quote?.feeSharePct ?? "0.00"

  return (
    <section className="panel featured-grid">
      <div className="featured-copy">
        <div className="badge-row">
          <span className="badge">
            {featured.source === "admin"
              ? "Admin Pick"
              : featured.source === "env"
                ? "Featured Twin"
                : featured.source === "performance"
                  ? "Performance Leader"
                  : "Auto Spotlight"}
          </span>
          <span className="muted">Source: {featured.sourceLabel}</span>
        </div>

        <div>
          <div className="feature-identity">
            {featured.twin.avatarUrl ? (
              <img
                src={buildImageProxyUrl(featured.twin.avatarUrl)}
                alt={featured.displayName}
                className="twin-avatar twin-avatar-xl"
              />
            ) : (
              <div className="twin-avatar twin-avatar-xl twin-avatar-fallback">
                {featured.displayName.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div>
              <h2 className="featured-title">{featured.displayName}</h2>
              {featured.twin.description ? (
                <p className="featured-description">{featured.twin.description}</p>
              ) : null}
            </div>
          </div>
          <div className="muted" style={{ marginTop: 10 }}>
            Twin ID: {featured.twin.id}
          </div>
        </div>

        <div className="stats-row">
          <div className="stat-block">
            <div className="stat-label">Supply</div>
            <div className="stat-value">{featured.twin.supply.toLocaleString()}</div>
          </div>
          <div className="stat-block">
            <div className="stat-label">Holders</div>
            <div className="stat-value">{featured.twin.holders.toLocaleString()}</div>
          </div>
          <div className="stat-block">
            <div className="stat-label">Trades</div>
            <div className="stat-value">{featured.twin.totalTrades.toLocaleString()}</div>
          </div>
        </div>

        <div className="featured-actions">
          <button className="btn-primary" type="button">
            Buy Keys: {quoteUsd}
          </button>
          <Link className="btn-secondary" href={`/twin/${featured.twin.id}`}>
            View Twin
          </Link>
        </div>
      </div>

      <div className="featured-quote">
        <div className="quote-panel">
          <div className="stat-label">Live Buy Quote</div>
          <div className="quote-big">{quoteUsd}</div>
          <div className="ticker">
            {featured.twin.change1hPct >= 0 ? "+" : ""}
            {featured.twin.change1hPct.toFixed(1)}% vs indexed last hour
          </div>
          <div className="footer-feed">
            24h Volume {formatUsd(featured.twin.volume24hUsd)} · Fee Share {feeShare}%
          </div>
        </div>
      </div>
    </section>
  )
}
