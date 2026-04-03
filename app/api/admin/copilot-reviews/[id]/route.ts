import { NextResponse } from "next/server"
import { isDatabaseConfigured } from "@/lib/server/db"
import { updateCopilotPromptReviewStatus } from "@/lib/server/copilot-review-store"
import type { CopilotPromptReviewStatus } from "@/lib/types"

const VALID_STATUSES = new Set<CopilotPromptReviewStatus>(["open", "reviewed", "ignored"])

function parseReviewId(value: string) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Copilot review queue requires DATABASE_URL to be configured." },
      { status: 503 }
    )
  }

  const { id } = await context.params
  const reviewId = parseReviewId(id)
  if (!reviewId) {
    return NextResponse.json({ error: "A valid review ID is required." }, { status: 400 })
  }

  const body = (await request.json().catch(() => null)) as { status?: string } | null
  const status = body?.status?.trim()
  if (!status || !VALID_STATUSES.has(status as CopilotPromptReviewStatus)) {
    return NextResponse.json({ error: "A valid review status is required." }, { status: 400 })
  }

  const review = await updateCopilotPromptReviewStatus(
    reviewId,
    status as CopilotPromptReviewStatus
  )

  if (!review) {
    return NextResponse.json({ error: "Review item not found." }, { status: 404 })
  }

  return NextResponse.json({ review }, { headers: { "Cache-Control": "no-store" } })
}
