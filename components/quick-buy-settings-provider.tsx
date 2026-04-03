"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { useWallet } from "@/components/wallet-provider"

type QuickBuySettingsContextValue = {
  quickBuyAmount: number | null
  loading: boolean
  hydrated: boolean
  error: string | null
  save: (nextAmount: number | null) => Promise<void>
}

const QuickBuySettingsContext = createContext<QuickBuySettingsContextValue | null>(null)

export function QuickBuySettingsProvider({ children }: { children: React.ReactNode }) {
  const { account, ensureSession } = useWallet()
  const [quickBuyAmount, setQuickBuyAmount] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!account) {
      setQuickBuyAmount(null)
      setError(null)
      setLoading(false)
      setHydrated(true)
      return
    }

    setLoading(true)
    setError(null)
    try {
      await ensureSession()
      const response = await fetch(
        `/api/settings/quick-buy?account=${encodeURIComponent(account)}`,
        { cache: "no-store" }
      )
      const payload = (await response.json()) as {
        quickBuyAmount?: number | null
        error?: string
      }

      if (!response.ok) {
        throw new Error(payload.error || "Failed to load quick buy settings.")
      }

      setQuickBuyAmount(
        typeof payload.quickBuyAmount === "number" ? payload.quickBuyAmount : null
      )
    } catch (cause) {
      setQuickBuyAmount(null)
      setError(
        cause instanceof Error ? cause.message : "Failed to load quick buy settings."
      )
    } finally {
      setLoading(false)
      setHydrated(true)
    }
  }, [account, ensureSession])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = useCallback(
    async (nextAmount: number | null) => {
      if (!account) {
        throw new Error("Connect your wallet before saving quick buy settings.")
      }

      setLoading(true)
      setError(null)
      try {
        await ensureSession()
        const response = await fetch("/api/settings/quick-buy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account, quickBuyAmount: nextAmount }),
        })
        const payload = (await response.json()) as {
          quickBuyAmount?: number | null
          error?: string
        }

        if (!response.ok) {
          throw new Error(payload.error || "Failed to save quick buy settings.")
        }

        setQuickBuyAmount(
          typeof payload.quickBuyAmount === "number" ? payload.quickBuyAmount : null
        )
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Failed to save quick buy settings."
        )
        throw cause
      } finally {
        setLoading(false)
        setHydrated(true)
      }
    },
    [account, ensureSession]
  )

  const value = useMemo(
    () => ({
      quickBuyAmount,
      loading,
      hydrated,
      error,
      save,
    }),
    [error, hydrated, loading, quickBuyAmount, save]
  )

  return (
    <QuickBuySettingsContext.Provider value={value}>
      {children}
    </QuickBuySettingsContext.Provider>
  )
}

export function useQuickBuySettings() {
  const value = useContext(QuickBuySettingsContext)
  if (!value) {
    throw new Error("useQuickBuySettings must be used within QuickBuySettingsProvider")
  }
  return value
}
