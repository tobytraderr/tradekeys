import { NextResponse } from "next/server"
import { getHomepageSnapshotForPublicRequest } from "@/lib/services/market/homepage"
import { recordApiEvent } from "@/lib/server/ops-observability"
import { enforcePublicApiRateLimit } from "@/lib/server/public-api-guard"

export async function GET(request: Request) {
  const rateLimited = enforcePublicApiRateLimit({
    request,
    route: "/api/home",
    method: "GET",
    bucket: "market-read",
  })
  if (rateLimited) {
    return rateLimited
  }

  const startedAt = Date.now()
  const snapshot = await getHomepageSnapshotForPublicRequest({ includeInsights: false })
  recordApiEvent({
    route: "/api/home",
    method: "GET",
    statusCode: 200,
    durationMs: Date.now() - startedAt,
  })
  return NextResponse.json(snapshot, {
    headers: {
      "Cache-Control": "no-store",
      ...(snapshot.error ? { "X-TradeKeys-Home-Error": "1" } : {}),
    },
  })
}
