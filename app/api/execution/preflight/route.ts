import { NextResponse } from "next/server"
import { recordApiEvent } from "@/lib/server/ops-observability"
import { enforcePublicApiRateLimit } from "@/lib/server/public-api-guard"
import {
  normalizeWallet,
  parsePositiveAmount,
  validateExecutionPreflight,
  type ExecutionAction,
} from "@/lib/server/execution"

export async function POST(request: Request) {
  const rateLimited = enforcePublicApiRateLimit({
    request,
    route: "/api/execution/preflight",
    method: "POST",
    bucket: "quote",
  })
  if (rateLimited) {
    return rateLimited
  }

  const startedAt = Date.now()
  const body = (await request.json().catch(() => null)) as
    | { action?: ExecutionAction; twinId?: string; amount?: string | number; wallet?: string }
    | null

  const action = body?.action
  if (action !== "buy" && action !== "sell") {
    recordApiEvent({
      route: "/api/execution/preflight",
      method: "POST",
      statusCode: 400,
      durationMs: Date.now() - startedAt,
    })
    return NextResponse.json({ error: "Action must be buy or sell." }, { status: 400 })
  }

  try {
    const payload = await validateExecutionPreflight({
      action,
      twinId: body?.twinId?.trim() ?? "",
      amount: parsePositiveAmount(body?.amount ?? "0"),
      wallet: normalizeWallet(body?.wallet),
    })

    recordApiEvent({
      route: "/api/execution/preflight",
      method: "POST",
      statusCode: 200,
      durationMs: Date.now() - startedAt,
    })
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Execution validation failed."
    const status = /valid|required|greater than zero|integer|bytes16|balance/i.test(message) ? 400 : 503
    recordApiEvent({
      route: "/api/execution/preflight",
      method: "POST",
      statusCode: status,
      durationMs: Date.now() - startedAt,
    })
    return NextResponse.json({ error: message }, { status })
  }
}
