import { NextResponse } from "next/server"
import { recordApiEvent } from "@/lib/server/ops-observability"
import { enforcePublicApiRateLimit } from "@/lib/server/public-api-guard"
import { isValidWalletAccount } from "@/lib/server/watchlist-store"
import { getPortfolioSnapshot } from "@/lib/services/portfolio"

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function GET(request: Request) {
  const rateLimited = enforcePublicApiRateLimit({
    request,
    route: "/api/portfolio",
    method: "GET",
    bucket: "market-read",
  })
  if (rateLimited) {
    return rateLimited
  }

  const startedAt = Date.now()
  const url = new URL(request.url)
  const account = url.searchParams.get("account")?.trim() ?? ""

  if (!isValidWalletAccount(account)) {
    recordApiEvent({
      route: "/api/portfolio",
      method: "GET",
      statusCode: 400,
      durationMs: Date.now() - startedAt,
    })
    return badRequest("A valid wallet account is required.")
  }

  const snapshot = await getPortfolioSnapshot(account)
  recordApiEvent({
    route: "/api/portfolio",
    method: "GET",
    statusCode: 200,
    durationMs: Date.now() - startedAt,
  })
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } })
}
