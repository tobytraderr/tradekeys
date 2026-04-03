import "server-only"

import { getMarketDataRuntimeSource, isLegacyMarketDataFallbackEnabled } from "@/lib/env"
import { searchCatalogTwins } from "@/lib/server/catalog-store"
import * as legacy from "@/lib/services/market/legacy"
import type { TwinSummary } from "@/lib/types"

export async function searchTwins(query: string, limit = 8): Promise<TwinSummary[]> {
  const normalized = query.trim()
  if (!normalized) {
    return []
  }

  try {
    const catalogMatches = await searchCatalogTwins(normalized, limit)
    if (catalogMatches.length > 0) {
      return catalogMatches
    }
  } catch (error) {
    console.error("[market] catalog search failed:", error)
  }

  if (getMarketDataRuntimeSource() === "legacy" || isLegacyMarketDataFallbackEnabled()) {
    return legacy.searchTwins(query, limit)
  }

  return []
}
