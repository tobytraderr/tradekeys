"use client"

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { useWallet } from "@/components/wallet-provider"
import type { TwinSummary } from "@/lib/types"

type WatchlistContextValue = {
  items: TwinSummary[]
  ids: string[]
  hydrated: boolean
  loading: boolean
  error: string | null
  isWatched: (id: string) => boolean
  add: (twin: TwinSummary) => Promise<void>
  remove: (id: string) => Promise<void>
  toggle: (twin: TwinSummary) => Promise<void>
}

type WatchlistPayload = {
  items?: TwinSummary[]
  error?: string
}

const WatchlistContext = createContext<WatchlistContextValue | null>(null)

export function WatchlistProvider({ children }: { children: React.ReactNode }) {
  const { account, ensureSession } = useWallet()
  const [items, setItems] = useState<TwinSummary[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!account) {
        setItems([])
        setError(null)
        setHydrated(true)
        return
      }

      setLoading(true)
      setError(null)
      try {
        await ensureSession()
        const response = await fetch(
          `/api/watchlist?account=${encodeURIComponent(account)}`,
          { cache: "no-store" }
        )
        const payload = (await response.json()) as WatchlistPayload
        if (!response.ok) {
          throw new Error(payload.error || "Failed to load watchlist.")
        }
        if (!cancelled) {
          setItems(Array.isArray(payload.items) ? payload.items : [])
        }
      } catch (cause) {
        if (!cancelled) {
          setItems([])
          setError(cause instanceof Error ? cause.message : "Failed to load watchlist.")
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
          setHydrated(true)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [account, ensureSession])

  const value = useMemo<WatchlistContextValue>(() => {
    const ids = items.map((item) => item.id)

    function isWatched(id: string) {
      return ids.includes(id)
    }

    async function mutate(method: "POST" | "DELETE", twinId: string) {
      if (!account) {
        throw new Error("Connect your wallet to use watchlist.")
      }

      setLoading(true)
      setError(null)
      try {
        await ensureSession()
        const response = await fetch("/api/watchlist", {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account, twinId }),
        })
        const payload = (await response.json()) as WatchlistPayload
        if (!response.ok) {
          throw new Error(payload.error || "Watchlist request failed.")
        }
        setItems(Array.isArray(payload.items) ? payload.items : [])
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : "Watchlist request failed."
        setError(message)
        throw new Error(message)
      } finally {
        setLoading(false)
      }
    }

    async function add(twin: TwinSummary) {
      await mutate("POST", twin.id)
    }

    async function remove(id: string) {
      await mutate("DELETE", id)
    }

    async function toggle(twin: TwinSummary) {
      if (isWatched(twin.id)) {
        await remove(twin.id)
        return
      }
      await add(twin)
    }

    return {
      items,
      ids,
      hydrated,
      loading,
      error,
      isWatched,
      add,
      remove,
      toggle,
    }
  }, [account, ensureSession, error, hydrated, items, loading])

  return <WatchlistContext.Provider value={value}>{children}</WatchlistContext.Provider>
}

export function useWatchlist() {
  const value = useContext(WatchlistContext)
  if (!value) {
    throw new Error("useWatchlist must be used within WatchlistProvider")
  }
  return value
}
