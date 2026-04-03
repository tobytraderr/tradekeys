import { NextResponse } from "next/server"
import { getFeaturedTwin } from "@/lib/services/market/homepage"
import { recordApiEvent } from "@/lib/server/ops-observability"
import { enforcePublicApiRateLimit } from "@/lib/server/public-api-guard"

export async function GET(request: Request) {
  const rateLimited = enforcePublicApiRateLimit({
    request,
    route: "/api/twins/featured",
    method: "GET",
    bucket: "market-read",
  })
  if (rateLimited) {
    return rateLimited
  }

  const startedAt = Date.now()
  const featured = await getFeaturedTwin()
  recordApiEvent({
    route: "/api/twins/featured",
    method: "GET",
    statusCode: 200,
    durationMs: Date.now() - startedAt,
  })
  return NextResponse.json(featured)
}
