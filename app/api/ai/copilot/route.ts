import { NextResponse } from "next/server"
import { sanitizeCopilotText } from "@/lib/copilot-security"
import { consumeCopilotQuota } from "@/lib/server/copilot-quota-store"
import { createCopilotPromptReview } from "@/lib/server/copilot-review-store"
import { createCopilotTraceId, logCopilotTrace } from "@/lib/server/copilot-trace-log"
import { recordApiEvent } from "@/lib/server/ops-observability"
import { enforcePublicApiRateLimit } from "@/lib/server/public-api-guard"
import { orchestrateCopilot } from "@/lib/services/copilot-orchestrator"
import type { CopilotMemory, TwinSummary } from "@/lib/types"
import { isValidWalletAccount } from "@/lib/server/watchlist-store"

export async function POST(request: Request) {
  const rateLimited = enforcePublicApiRateLimit({
    request,
    route: "/api/ai/copilot",
    method: "POST",
    bucket: "copilot",
  })
  if (rateLimited) {
    return rateLimited
  }

  const startedAt = Date.now()
  const body = (await request.json().catch(() => null)) as
    | {
        prompt?: string
        account?: string
        twins?: TwinSummary[]
        debug?: boolean
        history?: Array<{ prompt?: string; response?: string }>
        memory?: CopilotMemory
      }
    | null

  const prompt = sanitizeCopilotText(body?.prompt?.trim() ?? "", 1_200)
  const account = body?.account?.trim()
  if (!prompt) {
    recordApiEvent({
      route: "/api/ai/copilot",
      method: "POST",
      statusCode: 400,
      durationMs: Date.now() - startedAt,
    })
    return NextResponse.json({ error: "Prompt is required" }, { status: 400 })
  }
  if (account && !isValidWalletAccount(account)) {
    recordApiEvent({
      route: "/api/ai/copilot",
      method: "POST",
      statusCode: 400,
      durationMs: Date.now() - startedAt,
    })
    return NextResponse.json({ error: "A valid wallet account is required." }, { status: 400 })
  }

  const traceId = createCopilotTraceId()
  const quotaResult = await consumeCopilotQuota({ request, account })
  const quota = quotaResult.quota

  if (!quotaResult.allowed) {
    recordApiEvent({
      route: "/api/ai/copilot",
      method: "POST",
      statusCode: 429,
      durationMs: Date.now() - startedAt,
    })
    return NextResponse.json(
      {
        traceId,
        error: "Daily AI Copilot limit reached for this user. Try again tomorrow.",
        quota,
      },
      { status: 429 }
    )
  }

  const requestedTwins = Array.isArray(body?.twins)
    ? body.twins.slice(0, 6).filter((item): item is TwinSummary => {
        return Boolean(
          item &&
            typeof item.id === "string" &&
            typeof item.displayName === "string" &&
            typeof item.owner === "string"
        )
      })
    : []

  const history = Array.isArray(body?.history)
    ? body.history
        .filter(
          (entry): entry is { prompt: string; response: string } =>
            Boolean(
              entry &&
                typeof entry.prompt === "string" &&
                entry.prompt.trim() &&
                typeof entry.response === "string" &&
                entry.response.trim()
            )
        )
        .map((entry) => ({
          prompt: sanitizeCopilotText(entry.prompt, 500),
          response: sanitizeCopilotText(entry.response, 1_500),
        }))
        .slice(-3)
    : []

  const memory =
    body?.memory && Array.isArray(body.memory.activeTwins)
      ? {
          activeTwins: body.memory.activeTwins
            .filter(
              (entry): entry is { id: string; name: string } =>
                Boolean(entry && typeof entry.id === "string" && typeof entry.name === "string")
            )
            .map((entry) => ({
              id: entry.id.trim(),
              name: sanitizeCopilotText(entry.name, 120),
            }))
            .slice(0, 3),
        }
      : { activeTwins: [] }

  await logCopilotTrace({
    traceId,
    stage: "route.request_received",
    payload: {
      prompt,
      account: account && isValidWalletAccount(account) ? account.toLowerCase() : undefined,
      requestedTwins: requestedTwins.map((item) => ({
        id: item.id,
        name: item.displayName,
      })),
      history,
      memory,
      debug: Boolean(body?.debug),
    },
  })

  try {
    const result = await orchestrateCopilot({
      prompt,
      history,
      memory,
      requestedTwins,
      traceId,
    })

    await logCopilotTrace({
      traceId,
      stage: "route.response_ready",
      payload: {
        responseMode: result.responseMode,
        provider: result.provider,
        modelName: result.modelName,
        plan: result.plan,
        resolvedEntities: result.resolvedEntities,
        warnings: result.warnings,
        usedTwins: result.usedTwins.map((item) => ({
          id: item.id,
          name: item.displayName,
        })),
        availableActions: result.availableActions,
      },
    })

    if (result.responseMode === "clarification") {
      void createCopilotPromptReview({
        prompt,
        ...(account && isValidWalletAccount(account) ? { account } : {}),
        reason: "clarification_required",
        responseMode: result.responseMode,
        intent: result.plan.intent,
        confidence: result.plan.confidence,
        history,
        memory,
        requestedTwins,
        resolvedEntities: result.resolvedEntities,
        warnings: result.warnings,
      }).catch((error) => {
        console.error("[copilot-review] failed to store clarification prompt:", error)
      })
    }

    recordApiEvent({
      route: "/api/ai/copilot",
      method: "POST",
      statusCode: 200,
      durationMs: Date.now() - startedAt,
    })
    return NextResponse.json({
      prompt,
      traceId,
      quota,
      ...result,
      debug: body?.debug
        ? {
            traceId,
            planner: result.plan,
            resolvedEntities: result.resolvedEntities,
            warnings: result.warnings,
            twinsProvided: requestedTwins.length,
            twinsUsed: result.usedTwins.length,
            source: requestedTwins.length > 0 ? "client" : "system-tools",
          }
        : undefined,
    })
  } catch (error) {
    await logCopilotTrace({
      traceId,
      stage: "route.error",
      payload: {
        prompt,
        error: error instanceof Error ? error.message : "Copilot orchestration failed.",
      },
    })

    void createCopilotPromptReview({
      prompt,
      ...(account && isValidWalletAccount(account) ? { account } : {}),
      reason: "orchestration_error",
      history,
      memory,
      requestedTwins,
      errorMessage: error instanceof Error ? error.message : "Copilot orchestration failed.",
    }).catch((reviewError) => {
      console.error("[copilot-review] failed to store orchestration error:", reviewError)
    })

    recordApiEvent({
      route: "/api/ai/copilot",
      method: "POST",
      statusCode: 502,
      durationMs: Date.now() - startedAt,
    })
    return NextResponse.json(
      {
        traceId,
        quota,
        error: error instanceof Error ? error.message : "Copilot orchestration failed.",
      },
      { status: 502 }
    )
  }
}
