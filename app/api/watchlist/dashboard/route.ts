import { NextResponse } from "next/server"
import { isDatabaseConfigured } from "@/lib/server/db"
import { recordApiEvent } from "@/lib/server/ops-observability"
import { enforcePublicApiRateLimit } from "@/lib/server/public-api-guard"
import { requireVerifiedWalletSession } from "@/lib/server/wallet-session"
import { isValidWalletAccount } from "@/lib/server/watchlist-store"
import { getWatchlistDashboardForAccount } from "@/lib/services/market/watchlist"

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function serviceUnavailable() {
  return NextResponse.json(
    { error: "Watchlist persistence requires DATABASE_URL to be configured." },
    { status: 503 }
  )
}

export async function GET(request: Request) {
  const rateLimited = enforcePublicApiRateLimit({
    request,
    route: "/api/watchlist/dashboard",
    method: "GET",
    bucket: "market-read",
  })
  if (rateLimited) {
    return rateLimited
  }

  const startedAt = Date.now()
  if (!isDatabaseConfigured()) {
    recordApiEvent({
      route: "/api/watchlist/dashboard",
      method: "GET",
      statusCode: 503,
      durationMs: Date.now() - startedAt,
    })
    return serviceUnavailable()
  }

  const url = new URL(request.url)
  const account = url.searchParams.get("account")?.trim() ?? ""

  if (!isValidWalletAccount(account)) {
    recordApiEvent({
      route: "/api/watchlist/dashboard",
      method: "GET",
      statusCode: 400,
      durationMs: Date.now() - startedAt,
    })
    return badRequest("A valid wallet account is required.")
  }

  const sessionError = await requireVerifiedWalletSession(request, account)
  if (sessionError) {
    recordApiEvent({
      route: "/api/watchlist/dashboard",
      method: "GET",
      statusCode: sessionError.status,
      durationMs: Date.now() - startedAt,
    })
    return sessionError
  }

  const snapshot = await getWatchlistDashboardForAccount(account)
  recordApiEvent({
    route: "/api/watchlist/dashboard",
    method: "GET",
    statusCode: 200,
    durationMs: Date.now() - startedAt,
  })
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } })
}
