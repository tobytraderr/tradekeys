import Link from "next/link"
import { formatUsd } from "@/lib/currency"
import { buildImageProxyUrl } from "@/lib/image-proxy"
import type { TwinSummary } from "@/lib/types"

type Props = {
  twin: TwinSummary
}

export function TwinCard({ twin }: Props) {
  return (
    <article className="card">
      <div className="mini-title">
        <span className="twin-inline-title">
          {twin.avatarUrl ? (
            <img
              src={buildImageProxyUrl(twin.avatarUrl)}
              alt={twin.displayName}
              className="twin-avatar twin-avatar-sm"
            />
          ) : (
            <span className="twin-avatar twin-avatar-sm twin-avatar-fallback">
              {twin.displayName.slice(0, 1).toUpperCase()}
            </span>
          )}
          {twin.displayName}
        </span>
        <span className={twin.change1hPct >= 0 ? "ticker" : "danger"}>
          {twin.change1hPct >= 0 ? "+" : ""}
          {twin.change1hPct.toFixed(1)}%
        </span>
      </div>
      <div className="muted">{twin.id}</div>
      {twin.description ? (
        <p className="card-description">{twin.description}</p>
      ) : null}
      <div className="twin-card-price">{formatUsd(twin.lastPriceUsd)}</div>
      <div className="twin-card-meta">
        <span>Supply: {twin.supply.toLocaleString()}</span>
        <span>Holders: {twin.holders.toLocaleString()}</span>
        <span>Trades: {twin.totalTrades.toLocaleString()}</span>
      </div>
      <div className="featured-actions" style={{ marginTop: 18 }}>
        <Link className="btn-secondary" href={`/twin/${twin.id}`}>
          View Twin
        </Link>
      </div>
    </article>
  )
}
