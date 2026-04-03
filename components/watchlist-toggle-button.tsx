"use client"

import { useState } from "react"
import type { TwinSummary } from "@/lib/types"
import { useWallet } from "@/components/wallet-provider"
import { useWatchlist } from "@/components/watchlist-provider"

type Props = {
  twin: TwinSummary
}

export function WatchlistToggleButton({ twin }: Props) {
  const { account, connect, connecting } = useWallet()
  const { isWatched, toggle, hydrated, loading, error } = useWatchlist()
  const [localError, setLocalError] = useState<string | null>(null)
  const watched = isWatched(twin.id)

  async function handleClick() {
    setLocalError(null)
    if (!account) {
      await connect()
      return
    }

    try {
      await toggle(twin)
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : "Watchlist update failed.")
    }
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <button
        className="btn-secondary"
        type="button"
        onClick={() => void handleClick()}
        disabled={!hydrated || loading || connecting}
      >
        {loading
          ? "Updating Watchlist..."
          : account
            ? watched
              ? "Remove from Watchlist"
              : "Add to Watchlist"
            : "Connect Wallet to Watchlist"}
      </button>
      {(localError || error) ? (
        <div className="danger" style={{ fontSize: "0.85rem" }}>
          {localError || error}
        </div>
      ) : null}
    </div>
  )
}
