import "server-only"

import { getMarketDataRuntimeSource } from "@/lib/env"
import { getAppMeta, getHomepageSnapshot } from "@/lib/services/market/homepage"
import {
  buildAiCopilotSnapshotFromHomepage,
  buildCopilotInsightsFromHomepage,
} from "@/lib/services/market/formatting"
import * as legacy from "@/lib/services/market/legacy"
import type { AiCopilotSnapshot, CopilotInsight } from "@/lib/types"

export async function getAiCopilotSnapshot(options?: {
  includeInsights?: boolean
}): Promise<AiCopilotSnapshot> {
  if (getMarketDataRuntimeSource() !== "ingestion") {
    return legacy.getAiCopilotSnapshot(options)
  }

  const includeInsights = options?.includeInsights ?? true
  const [snapshot, meta] = await Promise.all([
    getHomepageSnapshot({ includeInsights }),
    getAppMeta(),
  ])

  return buildAiCopilotSnapshotFromHomepage({
    snapshot,
    totalTwins: meta.totalTwins,
    includeInsights,
  })
}

export async function getCopilotInsights(): Promise<CopilotInsight[]> {
  if (getMarketDataRuntimeSource() !== "ingestion") {
    return legacy.getCopilotInsights()
  }

  const snapshot = await getHomepageSnapshot({ includeInsights: false })
  return buildCopilotInsightsFromHomepage(snapshot)
}
