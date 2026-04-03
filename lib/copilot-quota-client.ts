"use client"

import type { CopilotQuotaSnapshot } from "@/lib/types"

export async function fetchCopilotQuota(account?: string | null): Promise<CopilotQuotaSnapshot> {
  const query = account ? `?account=${encodeURIComponent(account)}` : ""
  const response = await fetch(`/api/ai/copilot/quota${query}`, {
    cache: "no-store",
  })
  const payload = (await response.json()) as { quota?: CopilotQuotaSnapshot; error?: string }

  if (!response.ok || !payload.quota) {
    throw new Error(payload.error || "Failed to load copilot quota.")
  }

  return payload.quota
}
