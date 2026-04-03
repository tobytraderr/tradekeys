import { NextResponse } from "next/server"
import { isDatabaseConfigured } from "@/lib/server/db"
import { listCopilotPromptReviews } from "@/lib/server/copilot-review-store"
import type { CopilotPromptReviewStatus } from "@/lib/types"

const VALID_STATUSES = new Set<CopilotPromptReviewStatus>(["open", "reviewed", "ignored"])

export async function GET(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Copilot review queue requires DATABASE_URL to be configured." },
      { status: 503 }
    )
  }

  const url = new URL(request.url)
  const statusParam = url.searchParams.get("status")?.trim() ?? ""
  const limitParam = Number(url.searchParams.get("limit") ?? "50")
  const status =
    statusParam && VALID_STATUSES.has(statusParam as CopilotPromptReviewStatus)
      ? (statusParam as CopilotPromptReviewStatus)
      : undefined
  const limit = Number.isInteger(limitParam) && limitParam > 0 ? limitParam : 50

  const reviews = await listCopilotPromptReviews({ status, limit })
  return NextResponse.json({ reviews }, { headers: { "Cache-Control": "no-store" } })
}
