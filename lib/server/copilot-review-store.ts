import "server-only"

import { getDb, isDatabaseConfigured } from "@/lib/server/db"
import { isValidWalletAccount } from "@/lib/server/watchlist-store"
import type {
  CopilotMemory,
  CopilotPlan,
  CopilotPromptReview,
  CopilotPromptReviewReason,
  CopilotPromptReviewStatus,
  CopilotToolWarning,
  ResolvedTwinEntity,
  TwinSummary,
} from "@/lib/types"

function normalizeAccount(account: string) {
  return account.trim().toLowerCase()
}

function rowToPromptReview(row: Record<string, unknown>): CopilotPromptReview {
  const requestedTwins = Array.isArray(row.requested_twins)
    ? row.requested_twins.map((entry) => ({
        id: String((entry as { id?: unknown }).id ?? ""),
        name: String((entry as { name?: unknown }).name ?? ""),
      }))
    : undefined

  return {
    id: Number(row.id),
    prompt: String(row.prompt),
    ...(row.account ? { account: String(row.account) } : {}),
    reason: String(row.reason) as CopilotPromptReviewReason,
    status: String(row.status) as CopilotPromptReviewStatus,
    ...(row.response_mode ? { responseMode: String(row.response_mode) as CopilotPlan["responseMode"] } : {}),
    ...(row.intent ? { intent: String(row.intent) as CopilotPlan["intent"] } : {}),
    ...(typeof row.confidence === "number" ? { confidence: Number(row.confidence) } : {}),
    ...(Array.isArray(row.history)
      ? {
          history: row.history
            .map((entry) => ({
              prompt: String((entry as { prompt?: unknown }).prompt ?? ""),
              response: String((entry as { response?: unknown }).response ?? ""),
            }))
            .filter((entry) => entry.prompt && entry.response),
        }
      : {}),
    ...(row.memory && typeof row.memory === "object"
      ? { memory: row.memory as CopilotMemory }
      : {}),
    ...(requestedTwins ? { requestedTwins } : {}),
    ...(Array.isArray(row.resolved_entities)
      ? { resolvedEntities: row.resolved_entities as ResolvedTwinEntity[] }
      : {}),
    ...(Array.isArray(row.warnings) ? { warnings: row.warnings as CopilotToolWarning[] } : {}),
    ...(row.error_message ? { errorMessage: String(row.error_message) } : {}),
    createdAt: new Date(String(row.created_at)).toISOString(),
    ...(row.reviewed_at ? { reviewedAt: new Date(String(row.reviewed_at)).toISOString() } : {}),
  }
}

export async function initCopilotReviewSchema() {
  // Schema is owned by SQL migrations.
}

export async function createCopilotPromptReview(input: {
  prompt: string
  account?: string
  reason: CopilotPromptReviewReason
  responseMode?: CopilotPlan["responseMode"]
  intent?: CopilotPlan["intent"]
  confidence?: number
  history?: Array<{ prompt: string; response: string }>
  memory?: CopilotMemory
  requestedTwins?: TwinSummary[]
  resolvedEntities?: ResolvedTwinEntity[]
  warnings?: CopilotToolWarning[]
  errorMessage?: string
}) {
  if (!isDatabaseConfigured()) {
    return null
  }

  await initCopilotReviewSchema()
  const db = getDb()
  const result = await db.query(
    `
    insert into copilot_prompt_reviews (
      prompt,
      account,
      reason,
      response_mode,
      intent,
      confidence,
      history,
      memory,
      requested_twins,
      resolved_entities,
      warnings,
      error_message
    ) values (
      $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12
    )
    returning *
    `,
    [
      input.prompt,
      input.account && isValidWalletAccount(input.account) ? normalizeAccount(input.account) : null,
      input.reason,
      input.responseMode ?? null,
      input.intent ?? null,
      typeof input.confidence === "number" ? input.confidence : null,
      JSON.stringify(input.history ?? null),
      JSON.stringify(input.memory ?? null),
      JSON.stringify(
        input.requestedTwins?.map((twin) => ({
          id: twin.id,
          name: twin.displayName,
        })) ?? null
      ),
      JSON.stringify(input.resolvedEntities ?? null),
      JSON.stringify(input.warnings ?? null),
      input.errorMessage ?? null,
    ]
  )

  return rowToPromptReview(result.rows[0])
}

export async function listCopilotPromptReviews(options?: {
  status?: CopilotPromptReviewStatus
  limit?: number
}) {
  if (!isDatabaseConfigured()) {
    return []
  }

  await initCopilotReviewSchema()
  const db = getDb()
  const limit = Math.max(1, Math.min(options?.limit ?? 50, 200))

  const result = options?.status
    ? await db.query(
        `
        select *
        from copilot_prompt_reviews
        where status = $1
        order by created_at desc
        limit $2
        `,
        [options.status, limit]
      )
    : await db.query(
        `
        select *
        from copilot_prompt_reviews
        order by created_at desc
        limit $1
        `,
        [limit]
      )

  return result.rows.map((row) => rowToPromptReview(row))
}

export async function updateCopilotPromptReviewStatus(
  id: number,
  status: CopilotPromptReviewStatus
) {
  if (!isDatabaseConfigured()) {
    return null
  }

  await initCopilotReviewSchema()
  const db = getDb()
  const result = await db.query(
    `
    update copilot_prompt_reviews
    set
      status = $2,
      reviewed_at = case when $2 = 'open' then null else now() end
    where id = $1
    returning *
    `,
    [id, status]
  )

  return result.rows[0] ? rowToPromptReview(result.rows[0]) : null
}
