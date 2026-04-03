"use client"

import { useCallback, useEffect, useState } from "react"
import { fetchCopilotQuota } from "@/lib/copilot-quota-client"
import type { CopilotQuotaSnapshot } from "@/lib/types"

export function useCopilotQuota(account?: string | null) {
  const [quota, setQuota] = useState<CopilotQuotaSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const nextQuota = await fetchCopilotQuota(account)
      setQuota(nextQuota)
      return nextQuota
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to load copilot quota."
      setError(message)
      return null
    } finally {
      setLoading(false)
    }
  }, [account])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return {
    quota,
    loading,
    error,
    refresh,
    setQuota,
  }
}
