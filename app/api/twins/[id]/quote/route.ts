import { NextResponse } from "next/server"
import { recordApiEvent } from "@/lib/server/ops-observability"
import { enforcePublicApiRateLimit } from "@/lib/server/public-api-guard"
import {
  getExecutionQuote,
  normalizeWallet,
  parsePositiveAmount,
} from "@/lib/server/execution"

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const rateLimited = enforcePublicApiRateLimit({
    request,
    route: "/api/twins/[id]/quote",
    method: "GET",
    bucket: "quote",
  })
  if (rateLimited) {
    return rateLimited
  }

  const startedAt = Date.now()
  const { id } = await context.params
  const url = new URL(request.url)
  const amountParam = url.searchParams.get("amount")?.trim() || "1"
  const walletParam = url.searchParams.get("wallet")?.trim()

  try {
    const amount = parsePositiveAmount(amountParam)
    const wallet = normalizeWallet(walletParam)
    const quote = await getExecutionQuote({
      twinId: id,
      amount,
      wallet,
    })
    recordApiEvent({
      route: "/api/twins/[id]/quote",
      method: "GET",
      statusCode: 200,
      durationMs: Date.now() - startedAt,
    })
    return NextResponse.json(quote, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Quote unavailable."
    const status = /valid|integer|greater than zero|bytes16/i.test(message) ? 400 : 503
    recordApiEvent({
      route: "/api/twins/[id]/quote",
      method: "GET",
      statusCode: status,
      durationMs: Date.now() - startedAt,
    })
    return NextResponse.json(
      { error: message },
      { status }
    )
  }
}
